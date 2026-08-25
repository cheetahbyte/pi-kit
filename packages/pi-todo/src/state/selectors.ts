import type { Task, TaskStatus } from "../tool/types.js";
import type { TaskState } from "./state.js";

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
