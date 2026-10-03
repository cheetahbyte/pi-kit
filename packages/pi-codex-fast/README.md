# Codex fast mode

Request Codex's priority service tier without changing your model or reasoning effort.

## Load the extension

From the repository root, start Pi with:

```sh
pi -e ./packages/pi-codex-fast/src/index.ts
```

To install it persistently, run:

```sh
pi install ./packages/pi-codex-fast
```

If you already load the entire `pi-kit` package, reload Pi instead.

## Enable fast mode

- Run `/fast` to toggle fast mode.
- Run `/fast on` or `/fast off` to set it explicitly.
- Run `/fast status` to inspect the current setting.

Fast mode defaults to off. The setting follows the session branch and survives resume and reload.
New sessions start with fast mode off. Changes apply to subsequent requests, not requests already in flight.

The footer shows `Fast: on` when enabled on a compatible model.
Switching to an incompatible model leaves the preference enabled but shows `Fast: inactive`.

## Configure pi-footer

Add a **Pi Event Value** widget in pi-footer and set **Widget ID** to `codex-fast`.
Enable **Hide when empty** to hide the widget when fast mode is off.

The widget displays `Fast: on` or `Fast: inactive`, matching the native status.
The extension republishes its value after session changes, reload, model selection, and mode changes, and clears it on shutdown.

Alternatively, use a **Pi Extension Status** widget with **Status key** set to `pi-codex-fast`.
Choose one integration to avoid duplicate indicators. The extension requires no pi-footer dependency.

## Compatibility and usage

The extension supports the `openai-codex` provider using `openai-codex-responses` with these model IDs:

- `gpt-5.5`
- `gpt-5.6`
- `gpt-6-luna`
- `gpt-6-sol`
- `gpt-6-astra`
- `gpt-6.1-sol`

This explicit list follows OpenAI's [Codex speed documentation](https://developers.openai.com/codex/speed/).
Unknown models, API-key providers, and virtual model selections are not supported.

Fast mode sends `service_tier: "priority"`, matching the
[Codex request mapping](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs).
Pi applies the payload hook before both HTTP and WebSocket requests.
Disabled mode leaves the payload unchanged, including tiers configured elsewhere.

OpenAI currently lists 2.5× included subscription usage and 2× purchased-credit or Enterprise pay-as-you-go rates for Fast mode.
Availability depends on your plan, workspace, and rollout. A priority request does not guarantee priority service or a particular speed.
The footer reports the requested mode, not the tier delivered by OpenAI.
This extension does not adjust Pi's cost estimates or enable Ultrafast.

## Verify changes

```sh
bun run --cwd packages/pi-codex-fast typecheck
bun test
```
