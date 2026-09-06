import { fileURLToPath, pathToFileURL } from "node:url";

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export interface Location {
	uri: string;
	range: Range;
}

export interface LocationLink {
	targetUri: string;
	targetRange: Range;
	targetSelectionRange: Range;
}

export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: number;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
}

export interface SymbolInformation {
	name: string;
	kind: number;
	location: Location;
	containerName?: string;
}

export interface WorkspaceSymbol {
	name: string;
	kind: number;
	location: Location | { uri: string };
	containerName?: string;
}

export const SYMBOL_KINDS: Record<number, string> = {
	1: "file",
	2: "module",
	3: "namespace",
	4: "package",
	5: "class",
	6: "method",
	7: "property",
	8: "field",
	9: "constructor",
	10: "enum",
	11: "interface",
	12: "function",
	13: "variable",
	14: "constant",
	15: "string",
	16: "number",
	17: "boolean",
	18: "array",
	19: "object",
	20: "key",
	21: "null",
	22: "enum-member",
	23: "struct",
	24: "event",
	25: "operator",
	26: "type-parameter",
};

export const kindName = (kind: number): string =>
	SYMBOL_KINDS[kind] ?? `kind-${kind}`;

export const toUri = (path: string): string => pathToFileURL(path).toString();

export function fromUri(uri: string): string {
	try {
		return fileURLToPath(uri);
	} catch {
		return uri;
	}
}

export const isDocumentSymbol = (
	value: DocumentSymbol | SymbolInformation,
): value is DocumentSymbol =>
	(value as DocumentSymbol).selectionRange !== undefined;
