import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	selectTasksByStatus,
	selectTodoCounts,
	selectVisibleTasks,
} from "./state/selectors.js";
import { applyTaskMutation } from "./state/state-reducer.js";
import { commitState, getState, sid } from "./state/store.js";
import { buildToolResult } from "./tool/response-envelope.js";
import { COMMAND_NAME, TOOL_NAME, TodoParamsSchema } from "./tool/types.js";

export { TOOL_NAME } from "./tool/types.js";

export function registerTodoTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo",
		description: "Manage a task list to track multi-step progress.",
		parameters: TodoParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = sid(ctx);
			const result = applyTaskMutation(
				getState(sessionId),
				params.action,
				params,
			);
			commitState(sessionId, result.state);
			return buildToolResult(params.action, params, result.state, result.op);
		},
	});
}

export function registerTodosCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Show todos grouped by status.",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}

			const state = getState(sid(ctx));
			if (selectVisibleTasks(state).length === 0) {
				ctx.ui.notify("No todos", "info");
				return;
			}

			const counts = selectTodoCounts(state);
			const lines = [`${counts.completed}/${counts.total} completed`];
			for (const [status, heading] of [
				["pending", "── Pending ──"],
				["in_progress", "── In Progress ──"],
				["completed", "── Completed ──"],
			] as const) {
				const tasks = selectTasksByStatus(state, status);
				if (tasks.length > 0) {
					lines.push(
						heading,
						...tasks.map((task) => `#${task.id} ${task.subject}`),
					);
				}
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
