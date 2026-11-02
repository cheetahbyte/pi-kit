import { arr, bool, int, map, obj, oneOf, opt, str, unknown, type Static } from "@earendil-works/pi-schema";

export const TOOL_NAME = "todo";
export const COMMAND_NAME = "todos";
export const TASK_STATUSES = [
	"pending",
	"in_progress",
	"completed",
	"deleted",
] as const;
export const TASK_ACTIONS = [
	"create",
	"createMany",
	"update",
	"list",
	"get",
	"delete",
	"clear",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskAction = (typeof TASK_ACTIONS)[number];

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

export interface CreateTaskInput {
	subject: string;
	description?: string;
	activeForm?: string;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

export interface TaskDetails {
	action: TaskAction;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

export const TodoParamsSchema = obj({
	action: oneOf(TASK_ACTIONS),
	subject: opt(str()),
	description: opt(str()),
	activeForm: opt(str()),
	status: opt(oneOf(TASK_STATUSES)),
	blockedBy: opt(arr(int())),
	addBlockedBy: opt(arr(int())),
	removeBlockedBy: opt(arr(int())),
	owner: opt(str()),
	metadata: opt(map(unknown())),
	id: opt(int()),
	includeDeleted: opt(bool()),
	tasks: opt(
		arr(
			obj({
				subject: str(),
				description: opt(str()),
				activeForm: opt(str()),
				blockedBy: opt(arr(int())),
				owner: opt(str()),
				metadata: opt(map(unknown())),
			}, { open: true }),
		),
	),
}, { open: true });

export type TodoParams = Static<typeof TodoParamsSchema>;
