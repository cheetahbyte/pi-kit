import { Type, type Static } from "typebox";

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

export const TodoParamsSchema = Type.Object({
	action: Type.Union(TASK_ACTIONS.map((value) => Type.Literal(value))),
	subject: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	activeForm: Type.Optional(Type.String()),
	status: Type.Optional(
		Type.Union(TASK_STATUSES.map((value) => Type.Literal(value))),
	),
	blockedBy: Type.Optional(Type.Array(Type.Integer())),
	addBlockedBy: Type.Optional(Type.Array(Type.Integer())),
	removeBlockedBy: Type.Optional(Type.Array(Type.Integer())),
	owner: Type.Optional(Type.String()),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	id: Type.Optional(Type.Integer()),
	includeDeleted: Type.Optional(Type.Boolean()),
	tasks: Type.Optional(
		Type.Array(
			Type.Object({
				subject: Type.String(),
				description: Type.Optional(Type.String()),
				activeForm: Type.Optional(Type.String()),
				blockedBy: Type.Optional(Type.Array(Type.Integer())),
				owner: Type.Optional(Type.String()),
				metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			}),
		),
	),
});

export type TodoParams = Static<typeof TodoParamsSchema>;
