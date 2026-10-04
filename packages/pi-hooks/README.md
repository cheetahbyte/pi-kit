# Pi hooks

`@cheetahbyte/pi-hooks` runs [Claude Code-style hooks](https://code.claude.com/docs/en/hooks) in Pi. Hook scripts written for Claude Code work unchanged, because the package follows the same input and output protocol for command hooks. It has no runtime dependencies.

## Install

```sh
pi install npm:@cheetahbyte/pi-hooks
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## Configuration files

| File | Scope | Read when |
| --- | --- | --- |
| `~/.pi/agent/hooks.json` | All projects | Always |
| `.pi/hooks.json` | One project | Pi trusts the project |

Claude Code's own settings files aren't read. To reuse hooks from `~/.claude/settings.json`, copy its `hooks` key into one of these files:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "sh ~/.agents/hooks/guard.sh" }] }
    ]
  }
}
```

Hooks from the project file are added to the hooks from the global file, so both run. A handler that appears in both files runs once.

`"disableAllHooks": true` in either file turns all hooks off. The project file wins when both files set it.

Files are read when a session starts and on `/reload`.

## Supported events

| Hook event | Pi event | Matcher tests |
| --- | --- | --- |
| `SessionStart` | `session_start`, and `session_compact` with source `compact` | `startup`, `resume`, `clear`, `fork`, `compact` |
| `UserPromptSubmit` | `input` | No matcher |
| `PreToolUse` | `tool_call` | Tool name |
| `PostToolUse` | `tool_result` without an error | Tool name |
| `PostToolUseFailure` | `tool_result` with an error | Tool name |
| `Stop` | `agent_end` | No matcher |
| `PreCompact` | `session_before_compact` | `manual` or `auto` |
| `PostCompact` | `session_compact` | `manual` or `auto` |
| `SessionEnd` | `session_shutdown` | `clear`, `resume`, or `other` |

Other events are ignored, because Pi has no matching event.

## Tool names and input

Hooks see Claude Code's names for Pi's built-in tools, so existing matchers and scripts keep working:

| Pi tool | Name in hooks | Added input fields |
| --- | --- | --- |
| `bash` | `Bash` | None. `command` has the same name. |
| `read` | `Read` | `file_path` (absolute) |
| `write` | `Write` | `file_path` (absolute) |
| `edit` | `Edit` | `file_path` (absolute), and `old_string` and `new_string` from the first edit |
| `grep` | `Grep` | None |
| `find` | `Glob` | None |

A matcher is tested against both names, so `bash` also matches. Other tools, such as MCP tools, keep their Pi names.

Pi's own input fields stay in `tool_input` next to the added ones. When a hook returns `updatedInput`, the added fields are translated back.

## What hooks can do

| Output | Effect in Pi |
| --- | --- |
| `additionalContext`, or plain text from `SessionStart` and `UserPromptSubmit` | Added to the model's context as a hidden message, or next to the tool result for tool events. |
| Exit code 2, `permissionDecision: "deny"`, or `decision: "block"` | Blocks the tool call, prompt, or compaction. On `Stop`, the agent continues with the reason. On `PostToolUse`, the reason is added to the tool result. |
| `permissionDecision: "ask"` | Asks you to confirm the tool call. Without a UI, the call is blocked. |
| `updatedInput` | Replaces the tool input. |
| `continue: false` | Stops the agent. |
| `systemMessage` | Shown to you as a notification. |

`Stop` hooks receive `stop_hook_active` and `last_assistant_message`. A `Stop` hook can keep the agent going at most eight times in a row.

Matchers, the `if` field, `timeout`, exec form with `args`, and `${CLAUDE_PROJECT_DIR}` work as documented for Claude Code. The `if` field handles `Tool(pattern)` rules for Bash commands and file paths.

## Differences from Claude Code

- Only `command` handlers run. `http`, `mcp_tool`, `prompt`, and `agent` handlers are skipped.
- `async`, `asyncRewake`, `shell`, `once`, and `statusMessage` are ignored. Every hook blocks until it exits.
- `updatedToolOutput`, `sessionTitle`, `watchPaths`, `terminalSequence`, and `"defer"` are ignored.
- `permissionDecision: "allow"` has no effect, because Pi has no permission prompts to skip.
- Hook context longer than 10,000 characters is truncated instead of being saved to a file.
- Hooks from plugins, skills, subagents, and managed settings aren't loaded.
- `permission_mode` is always `"default"`. `prompt_id`, `effort`, and `duration_ms` aren't sent.
