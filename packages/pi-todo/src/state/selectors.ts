import type { Task, TaskStatus } from "../tool/types.ts";
import type { TaskState } from "./state.ts";

export const selectVisibleTasks = (state: TaskState): Task[] =>
	state.tasks.filter((task) => task.status !== "deleted");

export const selectTasksByStatus = (
	state: TaskState,
	status: TaskStatus,
): Task[] => selectVisibleTasks(state).filter((task) => task.status === status);

export const selectTodoCounts = (state: TaskState) => ({
	total: selectVisibleTasks(state).length,
	completed: selectTasksByStatus(state, "completed").length,
});
