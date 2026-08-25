import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { replayFromBranch } from "./state/replay.js";
import { evictSession, replaceState, sid } from "./state/store.js";
import { registerTodosCommand, registerTodoTool } from "./todo.js";

const isStaleContext = (error: unknown): boolean =>
	/stale after session replacement/.test(String(error));

export default function (pi: ExtensionAPI): void {
	registerTodoTool(pi);
	registerTodosCommand(pi);

	const replay = (
		ctx: Parameters<typeof sid>[0] & Parameters<typeof replayFromBranch>[0],
	): void => {
		try {
			replaceState(sid(ctx), replayFromBranch(ctx));
		} catch (error) {
			if (!isStaleContext(error)) throw error;
		}
	};

	pi.on("session_start", (_event, ctx) => replay(ctx));
	pi.on("session_compact", (_event, ctx) => replay(ctx));
	pi.on("session_tree", (_event, ctx) => replay(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		let sessionId = "";
		try {
			sessionId = sid(ctx);
		} catch (error) {
			if (!isStaleContext(error)) throw error;
		}
		evictSession(sessionId);
	});
}
