import {
	TASK_ACTIONS,
	TASK_STATUSES,
	type Task,
	type TaskDetails,
} from "../tool/types.js";
import { EMPTY_STATE, type TaskState } from "./state.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isOptionalString = (value: unknown): boolean =>
	value === undefined || typeof value === "string";

const isTaskIdList = (value: unknown): boolean =>
	value === undefined ||
	(Array.isArray(value) && value.every((id) => Number.isInteger(id) && id > 0));

function isTask(value: unknown): value is Task {
	if (!isRecord(value)) return false;
	return [
		typeof value.id === "number" && Number.isInteger(value.id) && value.id > 0,
		typeof value.subject === "string",
		TASK_STATUSES.includes(value.status as (typeof TASK_STATUSES)[number]),
		isOptionalString(value.description),
		isOptionalString(value.activeForm),
		isOptionalString(value.owner),
		isTaskIdList(value.blockedBy),
		value.metadata === undefined || isRecord(value.metadata),
	].every(Boolean);
}

export function isTaskDetails(value: unknown): value is TaskDetails {
	if (!isRecord(value) || !Array.isArray(value.tasks)) return false;
	const taskIds = value.tasks.map((task) => (isTask(task) ? task.id : 0));
	return (
		TASK_ACTIONS.includes(value.action as (typeof TASK_ACTIONS)[number]) &&
		isRecord(value.params) &&
		value.tasks.every(isTask) &&
		new Set(taskIds).size === taskIds.length &&
		typeof value.nextId === "number" &&
		Number.isInteger(value.nextId) &&
		value.nextId > Math.max(0, ...taskIds) &&
		(value.error === undefined || typeof value.error === "string")
	);
}

function cloneState(details: TaskDetails): TaskState {
	return {
		tasks: details.tasks.map((task) => ({
			...task,
			...(task.blockedBy ? { blockedBy: [...task.blockedBy] } : {}),
		})),
		nextId: details.nextId,
	};
}

export function replayFromBranch(ctx: {
	sessionManager: { getBranch(): Iterable<unknown> };
}): TaskState {
	let state: TaskState = { tasks: [], nextId: EMPTY_STATE.nextId };
	for (const entry of ctx.sessionManager.getBranch()) {
		const message =
			isRecord(entry) && isRecord(entry.message) ? entry.message : undefined;
		if (message?.role !== "toolResult" || message.toolName !== "todo") continue;
		if (isTaskDetails(message.details)) state = cloneState(message.details);
	}
	return state;
}
