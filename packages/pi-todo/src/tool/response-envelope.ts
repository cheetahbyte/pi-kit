import type { TaskState } from "../state/state.js";
import type { Op } from "../state/state-reducer.js";
import type { TaskAction, TaskDetails, TodoParams } from "./types.js";

function formatContent(op: Op): string {
	switch (op.kind) {
		case "create":
			return `Created #${op.taskId}`;
		case "createMany":
			return `Created ${op.taskIds.length} tasks`;
		case "update":
			return `Updated #${op.id}`;
		case "delete":
			return `Deleted #${op.id}`;
		case "clear":
			return `Cleared ${op.count} tasks`;
		case "list":
			return "Listed tasks";
		case "get":
			return `Task #${op.task.id}`;
		case "error":
			return `Error: ${op.message}`;
		default:
			throw new Error("unknown task operation");
	}
}

export function buildToolResult(
	action: TaskAction,
	params: TodoParams,
	state: TaskState,
	op: Op,
): { content: Array<{ type: "text"; text: string }>; details: TaskDetails } {
	const details: TaskDetails = {
		action,
		params: params as Record<string, unknown>,
		tasks: state.tasks,
		nextId: state.nextId,
		...(op.kind === "error" ? { error: op.message } : {}),
	};
	return { content: [{ type: "text", text: formatContent(op) }], details };
}
