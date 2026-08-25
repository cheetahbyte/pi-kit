import type { Task } from "../tool/types.js";
import { EMPTY_STATE, type TaskState } from "./state.js";

const sessions = new Map<string, TaskState>();

function cloneTask(task: Task): Task {
	return {
		...task,
		...(task.blockedBy ? { blockedBy: [...task.blockedBy] } : {}),
	};
}

function cloneState(state: TaskState): TaskState {
	return { tasks: state.tasks.map(cloneTask), nextId: state.nextId };
}

export function sid(ctx: {
	sessionManager: { getSessionId(): string };
}): string {
	return ctx.sessionManager.getSessionId() ?? "";
}

export function getState(sessionId: string): TaskState {
	return cloneState(sessions.get(sessionId) ?? EMPTY_STATE);
}

export function commitState(sessionId: string, next: TaskState): void {
	sessions.set(sessionId, cloneState(next));
}

export function replaceState(sessionId: string, next: TaskState): void {
	commitState(sessionId, next);
}

export function evictSession(sessionId: string): void {
	sessions.delete(sessionId);
}

export function __resetState(): void {
	sessions.clear();
}
