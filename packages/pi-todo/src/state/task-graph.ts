import type { Task } from "../tool/types.js";

export function detectCycle(
	taskList: readonly Task[],
	taskId: number,
	newBlockedBy: readonly number[],
): boolean {
	const edges = new Map<number, number[]>();
	for (const task of taskList) {
		edges.set(
			task.id,
			task.id === taskId
				? [...new Set([...(task.blockedBy ?? []), ...newBlockedBy])]
				: [...(task.blockedBy ?? [])],
		);
	}

	const visiting = new Set<number>();
	const visited = new Set<number>();
	const hasCycleFrom = (id: number): boolean => {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		for (const dependency of edges.get(id) ?? []) {
			if (hasCycleFrom(dependency)) return true;
		}
		visiting.delete(id);
		visited.add(id);
		return false;
	};

	return [...edges.keys()].some(hasCycleFrom);
}

export function hasDependencyCycle(taskList: readonly Task[]): boolean {
	return taskList.some((task) =>
		detectCycle(taskList, task.id, task.blockedBy ?? []),
	);
}

export function deriveBlocks(taskList: readonly Task[]): Map<number, number[]> {
	const blocks = new Map<number, number[]>();
	for (const task of taskList) {
		for (const dependency of task.blockedBy ?? []) {
			const dependents = blocks.get(dependency) ?? [];
			dependents.push(task.id);
			blocks.set(dependency, dependents);
		}
	}
	return blocks;
}
