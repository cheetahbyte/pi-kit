# Pi Claude Code

`@cheetahbyte/pi-claude-code` runs Claude models in Pi on your Claude Pro or Max subscription. It drives the official Claude Code CLI (`claude -p`) as the model client, while Pi keeps its own agent loop, tools, and compaction. It also shows how much of your plan limits you've used.

The transport is a port of NousResearch's [claude-subscription-directsdk](https://github.com/NousResearch/hermes-official-plugins/tree/main/claude-subscription-directsdk) Hermes plugin.

## Install

```sh
pi install npm:@cheetahbyte/pi-claude-code
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## Requirements

Install Claude Code and log in:

```sh
npm install -g @anthropic-ai/claude-code
claude auth login
```

The extension looks for `claude` on `PATH`, then in the usual install directories (`~/.local/bin`, `~/.claude/local`, `~/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`, `/opt/homebrew/bin`, `/usr/local/bin`). Set `PI_CLAUDE_SUB_COMMAND` to the binary's path if it lives elsewhere.

Claude Code owns the login. The extension never reads, copies, or sends your credentials, and it removes `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and cloud-backend variables from the CLI's environment so requests can't bill an API key.

## Select a model

The models are under the `claude-sub` provider:

```sh
pi --model claude-sub/claude-opus-5-5
```

| Model | Context |
| --- | --- |
| `claude-opus-5-5` | 1,000,000 |
| `claude-sonnet-5-5` | 1,000,000 |
| `claude-fable-5-1` | 1,000,000 |
| `claude-opus-5` | 1,000,000 |
| `claude-sonnet-5` | 1,000,000 |
| `claude-opus-4-8` | 1,000,000 |
| `claude-haiku-4-5-20251001` | 200,000 |

Message costs show as zero because the subscription covers them. Whether a model is included in your plan or draws usage credits depends on your account. For example, Fable draws usage credits from the first request on Pro.

## Plan limits

Run `/claude-usage` to see your session and weekly limits, including model-specific limits, with their reset times.

While a `claude-sub` model is selected, the extension also publishes a short status such as `session 8% · week 6%` under the status key `claude-usage`. It refreshes when a session starts, when you switch to a `claude-sub` model, and after each agent run, at most once a minute. To show it in pi-footer, add a `Pi Extension Status` widget with status key `claude-usage`.

The limits come from Claude Code's own `get_usage` request, so they use the CLI's login and make no model request. A Claude Code version without `get_usage` reports that no usage answer was given; run `claude update`.

## How requests work

Each turn starts a fresh `claude -p` process. Claude Code's own tools, skills, and setting sources are off. Pi's tools are advertised through an inert MCP server that refuses to run them, so only Pi executes tool calls. The conversation history is replayed as stream-json frames, and a loopback relay forwards exactly one Messages request per turn to `api.anthropic.com`.
