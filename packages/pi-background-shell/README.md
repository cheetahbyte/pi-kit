# Pi background shell

`@cheetahbyte/pi-background-shell` lets the agent start a long shell command, keep working, and hear back when it exits, like Claude Code's background Bash.

## Install

```sh
pi install npm:@cheetahbyte/pi-background-shell
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## Tools

| Tool | What it does |
| --- | --- |
| `bash_background` | Starts a command with the same shell as Pi's `bash` tool and returns a job id such as `bg-1` at once. |
| `bash_output` | Shows a job's status and the end of its output. |
| `bash_kill` | Stops a running job and its child processes. |

When a job exits, a message with its exit code, duration, and the last 40 lines of output arrives in the conversation. If the agent is idle, the message starts a new turn; if it is busy, the message waits until it finishes. Stopping a job with `bash_kill` sends no message.

Each job writes its full output to a log file in a temporary directory. Jobs and their logs end with the session: quitting, reloading, or switching sessions stops every running job.

## Commands

- `/bg` lists the session's jobs.
- `/bg kill <id>` stops one.

## Footer

The extension publishes the number of running jobs to the `background_shell` widget of [pi-footer](https://github.com/cheetahbyte/pi-footer). Add a `Pi Event Value` widget with `Widget ID` set to `background_shell`, and turn on hiding when empty so it disappears when nothing runs.
