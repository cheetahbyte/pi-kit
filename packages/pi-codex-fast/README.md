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
Hide the `pi-codex-fast` entry in pi-footer's extension status row to avoid a duplicate native indicator.
In `pi-footer.json`, this means adding `pi-codex-fast` to `extensionStatusRow.hiddenKeys`.
Publishing events does not automatically add a widget to your footer configuration.

The widget displays `Fast: on` or `Fast: inactive`, matching the native status.
The extension republishes its value after session changes, reload, model selection, and mode changes, and clears it on shutdown.

Alternatively, use a **Pi Extension Status** widget with **Status key** set to `pi-codex-fast`.
Choose one integration to avoid duplicate indicators. The extension requires no pi-footer dependency.

## Compatibility and usage

The extension allows all models on the `openai-codex` provider using `openai-codex-responses`, without filtering model names.
Other providers, API-key providers, and virtual model selections are not supported.

The provider check permits a priority request; it does not verify server-side eligibility.
OpenAI may reject or ignore priority for individual models. See the [Codex speed documentation](https://developers.openai.com/codex/speed/) for availability.

Fast mode sends `service_tier: "priority"`, matching the
[Codex request mapping](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs).
Pi applies the payload hook before both HTTP and WebSocket requests.
Disabled mode leaves the payload unchanged, including tiers configured elsewhere.

OpenAI currently lists 2.5× included subscription usage and 2× purchased-credit or Enterprise pay-as-you-go rates for Fast mode.
Availability depends on your plan, workspace, and rollout. A priority request does not guarantee priority service or a particular speed.
The footer reports the requested mode, not the tier delivered by OpenAI.
This extension does not enable Ultrafast.

## Cost estimates

For each fast-mode request, the extension records the model's base pricing at request time.
When its assistant message finishes, it recalculates input, output, cache-read, and cache-write costs from Pi's token counts and multiplies them by 2.
This replaces any provider-calculated multiplier rather than stacking on it.

The adjusted costs are saved with the message and used by Pi's session totals and pi-footer's cost widget.
Turning fast mode off or switching models during a request does not change that request's estimate.
Standard requests and existing session history are left unchanged.

These are monetary estimates for requested Fast mode, not confirmed charges or subscription-limit accounting.
The 2.5× included-usage multiplier is not applied to dollar costs.
Custom or zero registry prices remain the basis of the estimate.
If OpenAI ignores priority, or another extension overrides the request tier, the estimate can differ from actual billing.

## Verify changes

```sh
bun run --cwd packages/pi-codex-fast typecheck
bun test
```
