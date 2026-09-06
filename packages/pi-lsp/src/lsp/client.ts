import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { toUri } from "./protocol.js";
import type { ServerSpec } from "./servers.js";

const HEADER_END = "\r\n\r\n";

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

export class LspClient {
	private readonly proc: ChildProcess;
	private readonly pending = new Map<number, Pending>();
	private readonly opened = new Set<string>();
	private buffer = Buffer.alloc(0);
	private nextId = 1;
	private stderr = "";
	private exited: string | undefined;
	private ready: Promise<void> | undefined;

	constructor(
		readonly spec: ServerSpec,
		readonly root: string,
		private readonly timeoutMs: number,
	) {
		this.proc = spawn(spec.command, spec.args, {
			cwd: root,
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});
		this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
		this.proc.stderr?.on("data", (chunk: Buffer) => {
			this.stderr = (this.stderr + chunk.toString()).slice(-4000);
		});
		this.proc.on("error", (error) => this.fail(`spawn failed: ${error.message}`));
		this.proc.on("exit", (code, signal) =>
			this.fail(`server exited (code ${code ?? "null"}, signal ${signal ?? "none"})`),
		);
	}

	initialize(): Promise<void> {
		this.ready ??= this.doInitialize();
		return this.ready;
	}

	private async doInitialize(): Promise<void> {
		await this.request("initialize", {
			processId: process.pid,
			clientInfo: { name: "pi-lsp", version: "0.1.0" },
			rootUri: toUri(this.root),
			rootPath: this.root,
			workspaceFolders: [{ uri: toUri(this.root), name: this.root }],
			initializationOptions: this.spec.initializationOptions,
			capabilities: {
				workspace: {
					workspaceFolders: true,
					configuration: true,
					symbol: { dynamicRegistration: false },
				},
				textDocument: {
					synchronization: { dynamicRegistration: false, didSave: false },
					documentSymbol: {
						dynamicRegistration: false,
						hierarchicalDocumentSymbolSupport: true,
					},
					definition: { dynamicRegistration: false, linkSupport: true },
					references: { dynamicRegistration: false },
				},
			},
		});
		this.notify("initialized", {});
	}

	openDocument(path: string): void {
		if (this.opened.has(path)) return;
		this.opened.add(path);
		this.notify("textDocument/didOpen", {
			textDocument: {
				uri: toUri(path),
				languageId: this.spec.languageId(path),
				version: 1,
				text: readFileSync(path, "utf8"),
			},
		});
	}

	request<T>(method: string, params: unknown): Promise<T> {
		if (this.exited) return Promise.reject(new Error(this.detail(this.exited)));
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(this.detail(`${method} timed out after ${this.timeoutMs}ms`)));
			}, this.timeoutMs);
			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			});
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	notify(method: string, params: unknown): void {
		if (this.exited) return;
		this.send({ jsonrpc: "2.0", method, params });
	}

	dispose(): void {
		if (this.exited) return;
		try {
			this.notify("shutdown", undefined);
			this.notify("exit", undefined);
		} catch {}
		this.proc.kill();
	}

	private send(message: unknown): void {
		const body = Buffer.from(JSON.stringify(message), "utf8");
		this.proc.stdin?.write(
			`Content-Length: ${body.byteLength}${HEADER_END}`,
			"ascii",
		);
		this.proc.stdin?.write(body);
	}

	private onData(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (true) {
			const headerEnd = this.buffer.indexOf(HEADER_END);
			if (headerEnd === -1) return;
			const header = this.buffer.subarray(0, headerEnd).toString("ascii");
			const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1]);
			if (!Number.isFinite(length)) {
				this.buffer = this.buffer.subarray(headerEnd + HEADER_END.length);
				continue;
			}
			const start = headerEnd + HEADER_END.length;
			if (this.buffer.byteLength < start + length) return;
			const body = this.buffer.subarray(start, start + length).toString("utf8");
			this.buffer = this.buffer.subarray(start + length);
			try {
				this.dispatch(JSON.parse(body));
			} catch {}
		}
	}

	private dispatch(message: {
		id?: number;
		method?: string;
		result?: unknown;
		error?: { message?: string; code?: number };
	}): void {
		if (message.method !== undefined) {
			// Servers stall waiting on these; answer with a benign default.
			if (message.id !== undefined) {
				this.send({
					jsonrpc: "2.0",
					id: message.id,
					result: message.method === "workspace/configuration" ? [null] : null,
				});
			}
			return;
		}
		if (message.id === undefined) return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		clearTimeout(pending.timer);
		if (message.error) {
			pending.reject(new Error(this.detail(message.error.message ?? "request failed")));
			return;
		}
		pending.resolve(message.result);
	}

	private fail(reason: string): void {
		this.exited ??= reason;
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			clearTimeout(pending.timer);
			pending.reject(new Error(this.detail(reason)));
		}
	}

	private detail(reason: string): string {
		const tail = this.stderr.trim().split("\n").slice(-3).join(" | ");
		return `${this.spec.id}: ${reason}${tail ? ` (stderr: ${tail})` : ""}`;
	}
}
