# Pi sticky model

`@cheetahbyte/pi-sticky-model` remembers the model you switch to and the thinking level you pick for each model. Without it, Pi keeps both choices for the current session only, unless you save them with **Ctrl+S** in `/model` or `/thinking`.

## Install

```sh
pi install npm:@cheetahbyte/pi-sticky-model
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## What it saves

| When you | It saves |
| --- | --- |
| Switch models with **Ctrl+P**, `/model`, or an extension | The model as `defaultProvider` and `defaultModel`. |
| Change the thinking level with **Shift+Tab**, `/thinking`, or an extension | The level for the current model in `modelThinkingLevels`. |

Both go into Pi's global `settings.json`, in settings that Pi already reads. New sessions start with the last model you used. Each model starts with the level you last picked for it, and gets that level again when you switch to it.

For example, after you set one model to `xhigh` and another to `low`, cycling between them with **Ctrl+P** restores each model's own level.

## Limits

- Resuming a session keeps that session's model and doesn't change the saved default.
- Pi sessions that run at the same time share the settings file. The last change wins.
- A model without a saved level uses `defaultThinkingLevel`, which this package doesn't change.
- A thinking level set for a model in `enabledModels`, such as `provider/model:high`, is applied by Pi on each switch and takes priority until you change the level again.
