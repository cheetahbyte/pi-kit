# Pi btw

`@cheetahbyte/pi-btw` adds `/btw`, which asks the current model a side question. The model sees your conversation, but the question and answer stay out of it. The package has no runtime dependencies.

## Install

```sh
pi install npm:@cheetahbyte/pi-btw
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## Ask a side question

```text
/btw why did we pick the second approach?
```

The answer opens in an overlay. Press **Up** and **Down** to scroll and **Esc** to close. Closing the overlay before the answer arrives cancels the request.

You can ask while the agent is working. The model then sees the conversation up to the last tool call that has a result.

## Follow-up questions

Each answered question is stored in the session as a custom entry, so later side questions can refer to earlier ones, also after you resume the session. To start over, run:

```text
/btw clear
```

## Limits

The side question is sent with the whole current context. If the context is already full, the request can fail with a context overflow error. Compact the session and ask again.
