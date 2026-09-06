import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fromUri, type Location } from "../lsp/protocol.js";
import { lineAt, locationLabel, resolveSymbol } from "./shared.js";

const MAX_RESULTS = 200;

export interface ReferencesDetails {
	symbol: string;
	definedAt: string;
	count: number;
	truncated: boolean;
}

export function registerReferences(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "references",
		label: "References",
		description:
			"Find every reference to a symbol across the workspace via the language server. The name is resolved with workspace/symbol; if several symbols share the name the call errors and lists them, so pass path (or a qualified Container.name) to narrow it.",
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol name, optionally qualified as Container.name." }),
			path: Type.Optional(
				Type.String({ description: "Restrict resolution to the symbol declared in this file." }),
			),
			includeDeclaration: Type.Optional(
				Type.Boolean({ description: "Include the declaration itself. Default false." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const target = await resolveSymbol(params.symbol, ctx.cwd, params.path);
			const locations =
				(await target.session.client.request<Location[] | null>(
					"textDocument/references",
					{
						textDocument: { uri: target.uri },
						position: target.range.start,
						context: { includeDeclaration: params.includeDeclaration ?? false },
					},
				)) ?? [];

			const definedAt = locationLabel(target.uri, target.range, ctx.cwd);
			const shown = locations.slice(0, MAX_RESULTS);
			const details: ReferencesDetails = {
				symbol: params.symbol,
				definedAt,
				count: locations.length,
				truncated: locations.length > shown.length,
			};

			const header = `${target.name} declared at ${definedAt} — ${locations.length} reference${locations.length === 1 ? "" : "s"}`;
			if (locations.length === 0) {
				return { content: [{ type: "text" as const, text: header }], details };
			}

			const lines = shown.map((location) => {
				const path = fromUri(location.uri);
				return `${locationLabel(location.uri, location.range, ctx.cwd)}  ${lineAt(path, location.range.start.line)}`;
			});
			if (details.truncated) {
				lines.push(`... ${locations.length - shown.length} more not shown`);
			}
			return {
				content: [{ type: "text" as const, text: [header, ...lines].join("\n") }],
				details,
			};
		},
	});
}
