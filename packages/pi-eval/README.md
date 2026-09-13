# pi-eval

Closed-loop evaluation of the pi harness: AGENTS.md, skills, prompts, snippets, settings, extensions, packages.

Two loops:

- **Retrospective**: flagged sessions (corrections, repeated errors, high error rate) are digested and sent to a reviewer model together with a snapshot of the whole harness. It proposes the smallest change that would have avoided the friction. You accept, edit, or reject in `/eval`.
- **Forward**: eval cases under `~/.pi/agent/eval/cases/` run real `pi -p` sessions in a throwaway workspace and grade the trace. Proposals can be verified against a case instead of waiting for ten more sessions.

## Commands

| Command | What it does |
|---|---|
| `/eval` | Review pending proposals |
| `/eval check` | Recompute outcomes of applied proposals |
| `/eval audit [n]` | Cross-session audit of the last n sessions (background) |
| `/eval retro` | Retrospective on the current session (background) |
| `/eval run [glob]` | Run eval cases (background), e.g. `/eval run auth*` |
| `/eval results` | Table of recent case results |

## Eval case layout

```
~/.pi/agent/eval/cases/<name>/
  prompt.md          frontmatter + the prompt
  graders/<g>.md     one grader per file
  fixtures/          optional, copied into the workspace before the run
```

`prompt.md`:

```markdown
---
runs: 2
tools: read,bash
ablation: with-without
timeout_seconds: 300
---
There is a typo in README.md. Fix it.
```

`ablation: with-without` also runs the prompt with `--no-extensions --no-skills --no-context-files` and records the baseline score.

Graders:

```markdown
---
type: tool_used
tool: bash
min: 0
max: 0
input_match: git commit
---
```

| type | fields | passes when |
|---|---|---|
| `regex` | `pattern` (or body), `flags`, `match: contains\|not_contains`, `target: last_message\|trace` | pattern found (or not) |
| `tool_used` | `tool`, `min` (default 1), `max`, `input_match` | call count within bounds |
| `file_exists` | `path` glob, relative to the workspace | at least one match |
| `llm` | `criteria` (or body) | judge model answers PASS |

Results land in `~/.pi/agent/eval/results/<batch>/<case>.json`.

## Config

`~/.pi/agent/eval/config.json`, all keys optional:

```json
{
  "model": "openai-codex/gpt-5.6-luna",
  "thinking": "medium",
  "auto": true,
  "evalModel": "openai-codex/gpt-6-astra",
  "judgeModel": "openai-codex/gpt-5.6-luna",
  "correctionPatterns": ["^\\s*(?:no|wrong)[,.!\\s]"],
  "errorRateThreshold": 0.2,
  "minUserMessages": 4,
  "auditSessions": 30,
  "maxDigestChars": 60000
}
```

`model` is the reviewer for retro and audit. `evalModel` is the model under test (default: your pi default model). `judgeModel` grades `llm` graders (default: `model`).

## Proposal verify kinds

- `correction`: regex over user messages, before vs after apply
- `metric`: a session metric from the efficiency database
- `eval`: latest result of a case after apply; with `baseline` the delta decides, without it the case must score 1.0
