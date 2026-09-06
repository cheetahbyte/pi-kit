import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { disposeAll } from "./lsp/pool.js";
import { registerDefinition } from "./tools/definition.js";
import { registerOutline } from "./tools/outline.js";
import { registerReadSymbol } from "./tools/read-symbol.js";
import { registerReferences } from "./tools/references.js";

export default function (pi: ExtensionAPI): void {
	registerOutline(pi);
	registerReferences(pi);
	registerDefinition(pi);
	registerReadSymbol(pi);

	pi.on("session_shutdown", () => disposeAll());
	process.once("exit", disposeAll);
}
