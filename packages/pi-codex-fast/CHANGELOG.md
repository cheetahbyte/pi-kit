# Changelog

## Unreleased

- Replace `/fast` and separate preferences with selectable `openai-codex/<model>-fast` aliases, including RPC selection, priority request mapping, 2× pricing metadata, and the existing `⚡ fast` footer indicator.

- Display `⚡ fast` only when enabled and persist the preference per provider/model across sessions and restarts, replacing session-scoped state.

- Record fast-mode requests at 2× base monetary cost in Pi and pi-footer, without double-counting provider priority adjustments.

- Allow all `openai-codex` models using the Codex API without model-name filtering.

- Publish fast-mode status to pi-footer's `codex-fast` event widget while preserving the native status fallback.

- Add session-scoped `/fast` controls for compatible Codex models, priority requests, and a footer status.
