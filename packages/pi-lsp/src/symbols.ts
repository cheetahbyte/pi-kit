import {
	type DocumentSymbol,
	isDocumentSymbol,
	type Range,
	type SymbolInformation,
} from "./lsp/protocol.js";

export interface OutlineNode {
	name: string;
	qualified: string;
	kind: number;
	detail?: string;
	range: Range;
	selection: Range;
	depth: number;
	children: OutlineNode[];
}

type SymbolResult = DocumentSymbol[] | SymbolInformation[] | null;

export function toOutline(result: SymbolResult): OutlineNode[] {
	if (!result || result.length === 0) return [];
	if (isDocumentSymbol(result[0] as DocumentSymbol)) {
		return (result as DocumentSymbol[]).map((symbol) => fromDocumentSymbol(symbol, "", 0));
	}
	return (result as SymbolInformation[]).map((symbol) => ({
		name: symbol.name,
		qualified: symbol.containerName
			? `${symbol.containerName}.${symbol.name}`
			: symbol.name,
		kind: symbol.kind,
		range: symbol.location.range,
		selection: symbol.location.range,
		depth: 0,
		children: [],
	}));
}

function fromDocumentSymbol(
	symbol: DocumentSymbol,
	prefix: string,
	depth: number,
): OutlineNode {
	const qualified = prefix ? `${prefix}.${symbol.name}` : symbol.name;
	return {
		name: symbol.name,
		qualified,
		kind: symbol.kind,
		detail: symbol.detail,
		range: symbol.range,
		selection: symbol.selectionRange ?? symbol.range,
		depth,
		children: (symbol.children ?? []).map((child) =>
			fromDocumentSymbol(child, qualified, depth + 1),
		),
	};
}

export function flatten(nodes: OutlineNode[]): OutlineNode[] {
	return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

export const lastSegment = (name: string): string =>
	name.split(".").pop() as string;

/** sourcekit-lsp reports "area()" and "init(width:height:)"; callers ask for "area". */
export function baseName(name: string): string {
	const cut = lastSegment(name).indexOf("(");
	return cut === -1 ? lastSegment(name) : lastSegment(name).slice(0, cut);
}

export function matchByName(nodes: OutlineNode[], name: string): OutlineNode[] {
	const all = flatten(nodes);
	const exact = all.filter(
		(node) => node.qualified === name || node.name === name,
	);
	if (exact.length > 0) return exact;
	const suffix = all.filter((node) => node.qualified.endsWith(`.${name}`));
	if (suffix.length > 0) return suffix;
	const base = baseName(name);
	return all.filter((node) => baseName(node.qualified) === base);
}
