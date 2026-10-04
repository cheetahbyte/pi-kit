# Pi Codex fast

`@cheetahbyte/pi-codex-fast` adds `-fast` variants of Codex models. Select `openai-codex/<model>-fast` to request Codex's priority service tier. Select the normal model to turn it off.

## Install

```sh
pi install npm:@cheetahbyte/pi-codex-fast
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## Select a fast model

Use Pi's model picker to select a fast variant, for example:

- `openai-codex/gpt-6.1-sol-fast`
- `openai-codex/gpt-6-sol-fast`
- `openai-codex/gpt-5.6-sol-fast`

Or select it at startup:

```sh
pi --model openai-codex/gpt-6.1-sol-fast
```

The extension generates aliases from the running Pi version's built-in Codex catalog, not a hardcoded model-name allowlist.
Normal models remain available. Fast aliases preserve the base model's capabilities and use the same Codex OAuth login.
An existing model ending in `-fast` is not overwritten or given another suffix.
Models added only through `models.json` do not automatically receive aliases; generated aliases can have their own `models.json` overrides.

Requests send the original model ID with `service_tier: "priority"`. The `-fast` suffix is local to Pi.
Fast mode now follows Pi's model selection and session restoration. There is no `/fast` command or separate per-model preference.
Old preference files in `~/.pi/agent/extensions/pi-codex-fast/` are ignored and left untouched.

## RPC

The aliases are available through the normal model registry and RPC model selection when this extension is loaded:

```json
{"id":"fast","type":"set_model","provider":"openai-codex","modelId":"gpt-6.1-sol-fast"}
```

To disable fast mode, select `gpt-6.1-sol` instead.
The selected model's `-fast` suffix identifies fast mode. No separate pi-footer or native status indicator is published.

## Pricing and availability

Fast aliases advertise 2× base monetary rates for input, output, cache reads, cache writes, and context-dependent pricing tiers.
Completed assistant messages are recalculated using those rates, replacing any provider multiplier rather than stacking on it.
Pi's session totals and pi-footer's cost widget use these saved message costs. Existing history is unchanged.

These are estimates for requested Fast mode, not confirmed charges or subscription-limit accounting.
OpenAI currently lists 2.5× included subscription usage and 2× purchased-credit or Enterprise pay-as-you-go rates.
The 2.5× included-usage multiplier is not applied to dollar costs.
Eligibility depends on the model, account, and rollout; OpenAI can reject or ignore priority.
An extension that overrides the request tier can also make estimates differ from actual billing.
This extension does not enable Ultrafast.

See [Codex speed documentation](https://developers.openai.com/codex/speed/) and the
[Codex priority request mapping](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs).
