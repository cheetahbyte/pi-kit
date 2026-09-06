import { LspClient } from "./client.js";
import { findRoot, pickServer, resolvePath } from "./servers.js";

const TIMEOUT_MS = Number(process.env.PI_LSP_TIMEOUT_MS ?? 30000);

const clients = new Map<string, Promise<LspClient>>();

export interface Session {
	client: LspClient;
	path: string;
	root: string;
}

/** Servers only answer document requests for files they were told about, hence didOpen here. */
export async function sessionFor(path: string, cwd: string): Promise<Session> {
	const full = resolvePath(path, cwd);
	const spec = pickServer(full, cwd);
	const root = findRoot(full, spec, cwd);
	const key = `${spec.id} ${root}`;

	let pending = clients.get(key);
	if (!pending) {
		pending = (async () => {
			const client = new LspClient(spec, root, TIMEOUT_MS);
			await client.initialize();
			return client;
		})();
		clients.set(key, pending);
		pending.catch(() => clients.delete(key));
	}

	const client = await pending;
	client.openDocument(full);
	return { client, path: full, root };
}

export function disposeAll(): void {
	for (const [key, pending] of clients) {
		clients.delete(key);
		pending.then((client) => client.dispose()).catch(() => {});
	}
}
