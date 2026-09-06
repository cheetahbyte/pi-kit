import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { seedFile } from "../lsp/discover.js";
import { type Session, sessionFor } from "../lsp/pool.js";
import {
	type DocumentSymbol,
	fromUri,
	kindName,
	type Location,
	type Range,
	type SymbolInformation,
	toUri,
	type WorkspaceSymbol,
} from "../lsp/protocol.js";
import { baseName, type OutlineNode, toOutline } from "../symbols.js";

export interface Resolved {
	session: Session;
	name: string;
	kind: number;
	container?: string;
	uri: string;
	range: Range;
}

const RETRIES = 3;
const RETRY_DELAY_MS = 700;

export const rel = (path: string, cwd: string): string =>
	relative(cwd, path) || path;

export const locationLabel = (
	uri: string,
	range: Range,
	cwd: string,
): string =>
	`${rel(fromUri(uri), cwd)}:${range.start.line + 1}:${range.start.character + 1}`;

export async function documentSymbols(
	session: Session,
): Promise<OutlineNode[]> {
	const result = await session.client.request<
		DocumentSymbol[] | SymbolInformation[] | null
	>("textDocument/documentSymbol", {
		textDocument: { uri: toUri(session.path) },
	});
	return toOutline(result);
}

const sleep = (ms: number): Promise<void> =>
	new Promise((done) => setTimeout(done, ms));

async function querySymbols(
	session: Session,
	name: string,
): Promise<WorkspaceSymbol[]> {
	for (let attempt = 0; ; attempt++) {
		const result =
			(await session.client.request<WorkspaceSymbol[] | null>(
				"workspace/symbol",
				{ query: name },
			)) ?? [];
		// Indexing servers answer empty until the workspace is loaded.
		if (result.length > 0 || attempt >= RETRIES) return result;
		await sleep(RETRY_DELAY_MS);
	}
}

/**
 * Resolves a bare symbol name through workspace/symbol. Exact-name matches win;
 * several distinct definitions are an error the caller resolves with `path`.
 */
export async function resolveSymbol(
	symbol: string,
	cwd: string,
	pathHint: string | undefined,
): Promise<Resolved> {
	const session = await sessionFor(pathHint ?? seedFile(cwd), cwd);
	const bare = symbol.split(".").pop() as string;
	const candidates = await querySymbols(session, bare);

	// Servers differ: a method comes back as "Area", "Shape.Area", or "area()".
	let matches = candidates.filter(
		(entry) => entry.name === bare || qualifiedName(entry) === symbol,
	);
	if (matches.length === 0) {
		matches = candidates.filter((entry) => baseName(entry.name) === baseName(bare));
	}
	if (symbol.includes(".")) {
		const scoped = matches.filter((entry) =>
			qualifiedName(entry).endsWith(symbol),
		);
		if (scoped.length > 0) matches = scoped;
	}
	if (pathHint) {
		const scoped = matches.filter(
			(entry) => fromUri(uriOf(entry)) === session.path,
		);
		if (scoped.length > 0) matches = scoped;
	}

	if (matches.length === 0) {
		throw new Error(
			`no symbol named "${symbol}" in the workspace (server: ${session.client.spec.id}, root: ${rel(session.root, cwd)})`,
		);
	}

	const distinct = dedupe(matches);
	if (distinct.length > 1) {
		const listed = distinct
			.slice(0, 10)
			.map(
				(entry) =>
					`  ${kindName(entry.kind)} ${qualifiedName(entry)} at ${locationLabel(uriOf(entry), rangeOf(entry), cwd)}`,
			)
			.join("\n");
		const more = distinct.length > 10 ? `\n  ... ${distinct.length - 10} more` : "";
		throw new Error(
			`"${symbol}" is ambiguous, ${distinct.length} matches. Re-run with path set to one of these files, or qualify the name as Container.name:\n${listed}${more}`,
		);
	}

	const match = distinct[0] as WorkspaceSymbol;
	const uri = uriOf(match);
	const target = await sessionFor(fromUri(uri), cwd);
	return {
		session: target,
		name: match.name,
		kind: match.kind,
		container: match.containerName,
		uri,
		range: rangeOf(match),
	};
}

const qualifiedName = (symbol: WorkspaceSymbol): string =>
	symbol.containerName ? `${symbol.containerName}.${symbol.name}` : symbol.name;

const uriOf = (symbol: WorkspaceSymbol): string =>
	"uri" in symbol.location
		? symbol.location.uri
		: (symbol.location as Location).uri;

const rangeOf = (symbol: WorkspaceSymbol): Range =>
	(symbol.location as Location).range ?? {
		start: { line: 0, character: 0 },
		end: { line: 0, character: 0 },
	};

function dedupe(symbols: WorkspaceSymbol[]): WorkspaceSymbol[] {
	const seen = new Map<string, WorkspaceSymbol>();
	for (const symbol of symbols) {
		const range = rangeOf(symbol);
		const key = `${uriOf(symbol)}:${range.start.line}:${range.start.character}`;
		if (!seen.has(key)) seen.set(key, symbol);
	}
	return [...seen.values()];
}

export function readLines(
	path: string,
	startLine: number,
	endLine: number,
): string[] {
	const lines = readFileSync(path, "utf8").split("\n");
	return lines.slice(Math.max(0, startLine), Math.min(lines.length, endLine + 1));
}

export const lineAt = (path: string, line: number): string =>
	readLines(path, line, line)[0]?.trim() ?? "";
