# Pi context

`@cheetahbyte/pi-context` adds `/context`, which shows what fills the context window. It has no runtime dependencies.

## Install

```sh
pi install npm:@cheetahbyte/pi-context
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## Read the view

Run `/context` after at least one model response. The view shows a bar and one row for each category:

| Row | Contents |
| --- | --- |
| System prompt | The current system prompt. |
| Tool definitions | Schemas of the active tools. |
| Messages | Your messages, model text, and compaction summaries. |
| Tool calls | Tool calls and their results. |
| Free | Space left before compaction starts. |
| Compaction reserve | The `compaction.reserveTokens` setting. |

The total is the token count that the provider reported. Category sizes are estimated at four characters per token and scaled to match that total.

The last line shows input tokens, the cached share, and output tokens for the whole session.
