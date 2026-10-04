# Pi todo

`@cheetahbyte/pi-todo` gives the agent a `todo` tool for tracking multi-step work, and adds `/todos` so you can see the list.

## Install

```sh
pi install npm:@cheetahbyte/pi-todo
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## The todo tool

The agent calls `todo` with one of these actions:

| Action | What it does | Required fields |
| --- | --- | --- |
| `create` | Adds one task. | `subject` |
| `createMany` | Adds several tasks in one call. | `tasks` |
| `update` | Changes a task's fields, status, or dependencies. | `id` and at least one field |
| `get` | Returns one task. | `id` |
| `list` | Returns all tasks. Set `includeDeleted` to include deleted ones. | None |
| `delete` | Marks a task as deleted. | `id` |
| `clear` | Removes all tasks. | None |

A task has a `subject` and can have a `description`, an `activeForm`, an `owner`, `metadata`, and a `blockedBy` list of task IDs.

## Task status

A task is `pending`, `in_progress`, `completed`, or `deleted`. Only these changes are allowed:

| From | To |
| --- | --- |
| `pending` | `in_progress`, `completed`, `deleted` |
| `in_progress` | `pending`, `completed`, `deleted` |
| `completed` | `deleted` |
| `deleted` | None |

## Dependencies

`blockedBy` lists the tasks that must finish first. Use `addBlockedBy` and `removeBlockedBy` with `update` to change it. The tool rejects a dependency on a missing or deleted task, on the task itself, and any change that would create a cycle.

## Show the list

Run `/todos` to see the tasks grouped by status, with a count of completed tasks. The command requires interactive mode.

## Where tasks are stored

Tasks live in the session. The tool restores them from its own earlier results when a session starts, after compaction, and when you move to another branch of the session tree. Each branch therefore has its own task list.
