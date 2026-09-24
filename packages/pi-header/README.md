# Pi header

`@cheetahbyte/pi-header` replaces Pi's interactive header with a compact view of prompts, skills, extensions, and context.

## Context display

The **Context** row keeps the working-directory name and shows the exact source paths reported by Pi's `ResourceLoader`, in Pi's built-in order:

1. `getSystemPromptSource()`
2. `getAppendSystemPromptSources()`
3. `getAgentsFiles().agentsFiles`

Paths inside the working directory are project-relative. Other paths use a home-relative form when possible.

## Internal API coupling

Pi does not currently expose the resource loader through `ExtensionContext`. This extension installs an in-memory monkey patch on the exported `AgentSession` prototype. It captures the session's public `resourceLoader` during `bindExtensions()` and refreshes it during `reload()` before Pi emits `session_start`.

The patch is version-coupled to Pi's exported `AgentSession` and `ResourceLoader` APIs. If those APIs are unavailable, the extension warns and omits context paths. It never scans the filesystem, parses prompts, or guesses standard filenames. The patch changes only in-memory prototypes and state in the current Pi process.
