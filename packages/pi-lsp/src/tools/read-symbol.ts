import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sessionFor } from "../lsp/pool.js";
import { kindName } from "../lsp/protocol.js";
import { matchByName } from "../symbols.js";
import { documentSymbols, readLines, rel } from "./shared.js";

const DEFAULT_MAX_LINES = 200;

export interface ReadSymbolDetails {
	path: string;
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	truncated: boolean;
}

export function registerReadSymbol(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read_symbol",
		label: "Read symbol",
		description:
			"Read the source of one symbol in a file, located through its outline. Use it instead of reading a whole file when you only need one class, function, or method.",
		parameters: Type.Object({
			path: Type.String({ description: "File path, absolute or relative to the working directory." }),
			name: Type.String({ description: "Symbol name as it appears in the outline, optionally qualified as Container.name." }),
			maxLines: Type.Optional(
				Type.Integer({
					minimum: 1,
					description: `Maximum lines returned. Default ${DEFAULT_MAX_LINES}.`,
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const session = await sessionFor(params.path, ctx.cwd);
			const path = rel(session.path, ctx.cwd);
			const matches = matchByName(await documentSymbols(session), params.name);

			if (matches.length === 0) {
				throw new Error(`no symbol named "${params.name}" in ${path}`);
			}
			if (matches.length > 1) {
				const listed = matches
					.map((node) => `  ${kindName(node.kind)} ${node.qualified} [${node.range.start.line + 1}]`)
					.join("\n");
				throw new Error(
					`"${params.name}" is ambiguous in ${path}, ${matches.length} matches. Use one of these qualified names:\n${listed}`,
				);
			}

			const node = matches[0];
			const limit = params.maxLines ?? DEFAULT_MAX_LINES;
			const start = node.range.start.line;
			const end = node.range.end.line;
			const body = readLines(session.path, start, end);
			const truncated = body.length > limit;
			const shown = truncated ? body.slice(0, limit) : body;

			const width = String(start + shown.length).length;
			const numbered = shown.map(
				(line, index) => `${String(start + index + 1).padStart(width)}  ${line}`,
			);
			const header = `${path}:${start + 1}-${end + 1}  ${kindName(node.kind)} ${node.qualified}`;
			if (truncated) {
				numbered.push(
					`... truncated, ${body.length - limit} more lines (raise maxLines to see them)`,
				);
			}

			return {
				content: [{ type: "text" as const, text: [header, ...numbered].join("\n") }],
				details: {
					path,
					name: node.qualified,
					kind: kindName(node.kind),
					startLine: start + 1,
					endLine: end + 1,
					truncated,
				} satisfies ReadSymbolDetails,
			};
		},
	});
}
