import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	fromUri,
	type Location,
	type LocationLink,
	type Range,
} from "../lsp/protocol.js";
import { lineAt, locationLabel, resolveSymbol } from "./shared.js";

type DefinitionResult = Location | Location[] | LocationLink[] | null;

export interface DefinitionDetails {
	symbol: string;
	locations: string[];
}

function normalize(result: DefinitionResult): Location[] {
	if (!result) return [];
	const list = Array.isArray(result) ? result : [result];
	return list.map((entry) => {
		if ("targetUri" in entry) {
			return {
				uri: entry.targetUri,
				range: (entry.targetSelectionRange ?? entry.targetRange) as Range,
			};
		}
		return entry;
	});
}

export function registerDefinition(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "definition",
		label: "Definition",
		description:
			"Jump to where a symbol is defined, via the language server. The name is resolved with workspace/symbol; if several symbols share the name the call errors and lists them, so pass path (or a qualified Container.name) to narrow it.",
		parameters: Type.Object({
			symbol: Type.String({ description: "Symbol name, optionally qualified as Container.name." }),
			path: Type.Optional(
				Type.String({ description: "Restrict resolution to the symbol declared in this file." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const target = await resolveSymbol(params.symbol, ctx.cwd, params.path);
			const found = normalize(
				await target.session.client.request<DefinitionResult>(
					"textDocument/definition",
					{
						textDocument: { uri: target.uri },
						position: target.range.start,
					},
				),
			);

			// Some servers answer nothing when the position already is the declaration.
			const locations =
				found.length > 0 ? found : [{ uri: target.uri, range: target.range }];
			const lines = locations.map((location) => {
				const label = locationLabel(location.uri, location.range, ctx.cwd);
				return `${label}  ${lineAt(fromUri(location.uri), location.range.start.line)}`;
			});

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					symbol: params.symbol,
					locations: locations.map((location) =>
						locationLabel(location.uri, location.range, ctx.cwd),
					),
				} satisfies DefinitionDetails,
			};
		},
	});
}
