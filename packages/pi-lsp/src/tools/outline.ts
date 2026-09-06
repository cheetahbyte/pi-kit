import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sessionFor } from "../lsp/pool.js";
import { kindName } from "../lsp/protocol.js";
import { flatten, type OutlineNode } from "../symbols.js";
import { documentSymbols, rel } from "./shared.js";

export interface OutlineDetails {
	path: string;
	server: string;
	count: number;
	error?: string;
}

export function formatOutline(nodes: OutlineNode[]): string[] {
	return flatten(nodes).map((node) => {
		const indent = "  ".repeat(node.depth);
		const lines =
			node.range.start.line === node.range.end.line
				? `${node.range.start.line + 1}`
				: `${node.range.start.line + 1}-${node.range.end.line + 1}`;
		const detail = node.detail ? ` ${node.detail}` : "";
		return `${indent}${kindName(node.kind)} ${node.name}${detail}  [${lines}]`;
	});
}

export function registerOutline(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "outline",
		label: "Outline",
		description:
			"List the symbols declared in a file (classes, functions, methods, fields) with their line ranges, via the language server. Use it instead of reading a whole file to find what is in it.",
		parameters: Type.Object({
			path: Type.String({ description: "File path, absolute or relative to the working directory." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const session = await sessionFor(params.path, ctx.cwd);
			const nodes = await documentSymbols(session);
			const path = rel(session.path, ctx.cwd);
			const details: OutlineDetails = {
				path,
				server: session.client.spec.id,
				count: flatten(nodes).length,
			};
			if (nodes.length === 0) {
				return {
					content: [{ type: "text" as const, text: `${path}: no symbols reported` }],
					details,
				};
			}
			return {
				content: [
					{ type: "text" as const, text: [path, ...formatOutline(nodes)].join("\n") },
				],
				details,
			};
		},
	});
}
