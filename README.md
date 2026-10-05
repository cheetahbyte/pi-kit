# Pi kit

A set of extensions for the [Pi coding agent](https://github.com/earendil-works/pi). Install everything at once, or pick single packages.

## Requirements

Pi 1.0.2 or newer. This applies to the kit and to every package in it.

## Install the kit

```sh
pi install npm:@cheetahbyte/pi-kit
```

To track the repository instead:

```sh
pi install git:https://github.com/cheetahbyte/pi-kit
```

## Packages

Each package in `packages/` is also published on its own. Install one with `pi install npm:<name>`.

| Package | What it adds |
| --- | --- |
| `@cheetahbyte/pi-ask-user-question` | The `ask_user_question` tool for structured questions. |
| `@cheetahbyte/pi-btw` | `/btw` asks a side question without adding it to the conversation. |
| `@cheetahbyte/pi-codex-fast` | `-fast` variants of Codex models. |
| `@cheetahbyte/pi-claude-code` | `claude_code` tool and `/claude` command that delegate tasks to headless Claude Code on your Claude subscription. |
| `@cheetahbyte/pi-context` | `/context` shows what fills the context window. |
| `@cheetahbyte/pi-header` | A compact header with prompts, skills, extensions, and context. |
| `@cheetahbyte/pi-hooks` | Claude Code-style command hooks from `~/.pi/agent/hooks.json` and `.pi/hooks.json`. |
| `pi-hot-compact` | Background compaction and recall of omitted history. |
| `@cheetahbyte/pi-snippets` | Reusable text before or after your messages. |
| `@cheetahbyte/pi-sticky-model` | Remembers the model you switch to and the thinking level for each model. |
| `@cheetahbyte/pi-stats` | `/stats` shows cost, token, model, project, tool, and skill usage. |
| `@cheetahbyte/pi-todo` | A todo tool with a task graph and `/todos`. |
| `@cheetahbyte/pi-web` | Web search and page fetching without an API key. |

The kit also bundles two packages that are maintained elsewhere:

| Package | What it adds |
| --- | --- |
| [`@cheetahbyte/pi-subagents`](https://github.com/cheetahbyte/pi-subagents) | Subagents and workflows. |
| [`@cheetahbyte/pi-footer`](https://github.com/cheetahbyte/pi-footer) | A configurable footer. |

If you install the kit, remove these packages and any single kit package from your Pi settings. Otherwise Pi loads them twice.

`@cheetahbyte/pi-web` registers the same tool names as [`pi-web-access`](https://github.com/nicobailon/pi-web-access), so remove that package too. Keep it instead of the kit's web tools only if you need its PDF or video support, and then disable the `pi-web` extension with `pi config`.

## Develop

```sh
bun install
bun run typecheck
bun test
```

## Release

All packages and the kit share one version. A GitHub Actions workflow publishes them to npm when you push a version tag.

1. Set the new version in every manifest and update the lockfile:

   ```sh
   bun run set-version 0.3.1
   bun install
   ```

2. Commit the change, then tag it and push:

   ```sh
   git tag v0.3.1
   git push --follow-tags
   ```

The workflow in `.github/workflows/release.yml` checks that every manifest matches the tag, runs the typecheck and the tests, and publishes the packages and the kit. A version that is already on npm is skipped, so you can run a failed release again.

The workflow uses npm trusted publishing and needs no token. Each package on npmjs.com must list this repository and `release.yml` as a trusted publisher.

The kit bundles its third-party packages, which Bun's `node_modules` layout can't provide. The workflow therefore builds the kit tarball from a clean npm install with `bun run pack`. To publish by hand, run the same command and publish the tarball it writes.
