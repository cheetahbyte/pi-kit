import type {
	CreateTaskInput,
	Task,
	TaskAction,
	TaskStatus,
	TodoParams,
} from "../tool/types.js";
import { isTransitionValid } from "./invariants.js";
import type { TaskState } from "./state.js";
import { detectCycle, hasDependencyCycle } from "./task-graph.js";

export type Op =
	| { kind: "create"; taskId: number }
	| { kind: "createMany"; taskIds: number[] }
	| {
			kind: "update";
			id: number;
			fromStatus: TaskStatus;
			toStatus: TaskStatus;
			changed: boolean;
	  }
	| { kind: "delete"; id: number; subject: string }
	| { kind: "list"; statusFilter?: TaskStatus; includeDeleted: boolean }
	| { kind: "get"; task: Task }
	| { kind: "clear"; count: number }
	| { kind: "error"; message: string };

export interface ApplyResult {
	state: TaskState;
	op: Op;
}

function sameNumberList(
	a: number[] | undefined,
	b: number[] | undefined,
): boolean {
	const x = a ?? [];
	const y = b ?? [];
	return x.length === y.length && x.every((value, index) => value === y[index]);
}

function taskChanged(before: Task, after: Task): boolean {
	return (
		before.subject !== after.subject ||
		before.status !== after.status ||
		before.description !== after.description ||
		before.activeForm !== after.activeForm ||
		before.owner !== after.owner ||
		!sameNumberList(before.blockedBy, after.blockedBy) ||
		JSON.stringify(before.metadata ?? null) !==
			JSON.stringify(after.metadata ?? null)
	);
}

function taskFromInput(id: number, input: CreateTaskInput): Task {
	const task: Task = { id, subject: input.subject, status: "pending" };
	if (input.description) task.description = input.description;
	if (input.activeForm) task.activeForm = input.activeForm;
	if (input.blockedBy?.length) task.blockedBy = [...input.blockedBy];
	if (input.owner) task.owner = input.owner;
	if (input.metadata) task.metadata = { ...input.metadata };
	return task;
}

export function applyTaskMutation(
	state: TaskState,
	action: TaskAction,
	params: TodoParams,
): ApplyResult {
	const error = (message: string): ApplyResult => ({
		state,
		op: { kind: "error", message },
	});

	if (action === "create") {
		if (!params.subject?.trim()) return error("subject required for create");
		for (const dependency of params.blockedBy ?? []) {
			const task = state.tasks.find((candidate) => candidate.id === dependency);
			if (!task) return error(`blockedBy: #${dependency} not found`);
			if (task.status === "deleted")
				return error(`blockedBy: #${dependency} is deleted`);
		}
		const task = taskFromInput(state.nextId, {
			...params,
			subject: params.subject,
		});
		return {
			state: { tasks: [...state.tasks, task], nextId: state.nextId + 1 },
			op: { kind: "create", taskId: task.id },
		};
	}

	if (action === "createMany") {
		const inputs = params.tasks;
		if (!Array.isArray(inputs) || inputs.length === 0)
			return error("tasks must be a non-empty array");
		const ids = inputs.map((_, index) => state.nextId + index);
		const existing = new Map(state.tasks.map((task) => [task.id, task]));

		for (const [index, input] of inputs.entries()) {
			if (!input.subject.trim())
				return error(`tasks[${index}].subject must not be empty`);
			const dependencies = input.blockedBy ?? [];
			if (new Set(dependencies).size !== dependencies.length) {
				return error(`tasks[${index}] has duplicate dependencies`);
			}
			for (const dependency of dependencies) {
				if (dependency === ids[index])
					return error(`tasks[${index}] cannot depend on itself`);
				const batchIndex = ids.indexOf(dependency);
				if (batchIndex !== -1) {
					if (batchIndex >= index)
						return error(
							`tasks[${index}] may depend only on earlier batch tasks`,
						);
					continue;
				}
				const task = existing.get(dependency);
				if (!task)
					return error(`tasks[${index}] has unknown dependency ${dependency}`);
				if (task.status === "deleted")
					return error(`tasks[${index}] dependency #${dependency} is deleted`);
			}
		}

		const tasks = inputs.map((input, index) =>
			taskFromInput(ids[index], input),
		);
		if (hasDependencyCycle([...state.tasks, ...tasks]))
			return error("task dependencies contain a cycle");
		return {
			state: {
				tasks: [...state.tasks, ...tasks],
				nextId: state.nextId + tasks.length,
			},
			op: { kind: "createMany", taskIds: ids },
		};
	}

	if (action === "update") {
		if (params.id === undefined) return error("id required for update");
		const index = state.tasks.findIndex((task) => task.id === params.id);
		if (index === -1) return error(`#${params.id} not found`);
		const current = state.tasks[index];
		const hasMutation =
			params.subject !== undefined ||
			params.description !== undefined ||
			params.activeForm !== undefined ||
			params.status !== undefined ||
			params.owner !== undefined ||
			params.metadata !== undefined ||
			(params.addBlockedBy?.length ?? 0) > 0 ||
			(params.removeBlockedBy?.length ?? 0) > 0;
		if (!hasMutation)
			return error("update requires at least one mutable field");
		if (
			params.status !== undefined &&
			!isTransitionValid(current.status, params.status)
		) {
			return error(`illegal transition ${current.status} → ${params.status}`);
		}

		let blockedBy = [...(current.blockedBy ?? [])];
		if (params.removeBlockedBy?.length)
			blockedBy = blockedBy.filter(
				(id) => !params.removeBlockedBy?.includes(id),
			);
		for (const dependency of params.addBlockedBy ?? []) {
			if (dependency === current.id)
				return error(`cannot block #${current.id} on itself`);
			const task = state.tasks.find((candidate) => candidate.id === dependency);
			if (!task) return error(`addBlockedBy: #${dependency} not found`);
			if (task.status === "deleted")
				return error(`addBlockedBy: #${dependency} is deleted`);
			if (!blockedBy.includes(dependency)) blockedBy.push(dependency);
		}
		if (
			params.addBlockedBy?.length &&
			detectCycle(state.tasks, current.id, blockedBy)
		) {
			return error("addBlockedBy would create a cycle in the blockedBy graph");
		}

		let metadata = current.metadata;
		if (params.metadata !== undefined) {
			const merged = { ...(current.metadata ?? {}) };
			for (const [key, value] of Object.entries(params.metadata)) {
				if (value === null) delete merged[key];
				else merged[key] = value;
			}
			metadata = Object.keys(merged).length ? merged : undefined;
		}
		const updated: Task = {
			...current,
			status: params.status ?? current.status,
		};
		if (params.subject !== undefined) updated.subject = params.subject;
		if (params.description !== undefined)
			updated.description = params.description;
		if (params.activeForm !== undefined) updated.activeForm = params.activeForm;
		if (params.owner !== undefined) updated.owner = params.owner;
		if (blockedBy.length) updated.blockedBy = blockedBy;
		else delete updated.blockedBy;
		if (metadata === undefined) delete updated.metadata;
		else updated.metadata = metadata;
		const tasks = [...state.tasks];
		tasks[index] = updated;
		return {
			state: { tasks, nextId: state.nextId },
			op: {
				kind: "update",
				id: updated.id,
				fromStatus: current.status,
				toStatus: updated.status,
				changed: taskChanged(current, updated),
			},
		};
	}

	if (action === "list") {
		return {
			state,
			op: {
				kind: "list",
				includeDeleted: params.includeDeleted === true,
				...(params.status !== undefined ? { statusFilter: params.status } : {}),
			},
		};
	}
	if (action === "get") {
		if (params.id === undefined) return error("id required for get");
		const task = state.tasks.find((candidate) => candidate.id === params.id);
		return task
			? { state, op: { kind: "get", task } }
			: error(`#${params.id} not found`);
	}
	if (action === "delete") {
		if (params.id === undefined) return error("id required for delete");
		const index = state.tasks.findIndex((task) => task.id === params.id);
		if (index === -1) return error(`#${params.id} not found`);
		const current = state.tasks[index];
		if (current.status === "deleted")
			return error(`#${current.id} is already deleted`);
		const updated = { ...current, status: "deleted" as const };
		const tasks = [...state.tasks];
		tasks[index] = updated;
		return {
			state: { tasks, nextId: state.nextId },
			op: { kind: "delete", id: updated.id, subject: updated.subject },
		};
	}
	return {
		state: { tasks: [], nextId: 1 },
		op: { kind: "clear", count: state.tasks.length },
	};
}
