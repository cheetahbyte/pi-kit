# Pi stats

`@cheetahbyte/pi-stats` adds `/stats`, which shows your Pi usage. It reads the session files Pi already writes, so it records nothing in the background and has no runtime dependencies.

## Install

```sh
pi install npm:@cheetahbyte/pi-stats
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

## Show usage

```text
/stats        last 30 days
/stats 7      last 7 days
/stats all    all sessions
```

Press **Tab** to switch views, **Up** and **Down** to scroll, and **Esc** to close.

| View | Contents |
| --- | --- |
| Overview | Sessions, model calls, cost, tokens, cached share, and cost per active day. |
| Models | Calls, cost, and tokens for each model. |
| Projects | Calls, cost, and tokens for each working directory. |
| Tools | Calls and failed calls for each tool. |
| Skills | How often the agent read each skill's `SKILL.md`. |

Days are counted in UTC. Costs are the amounts Pi stored with each model response.

## Cache

The first run parses every session file. Results are cached in `~/.pi/agent/stats-cache.json`, and later runs parse only new or changed files. You can delete the cache file at any time.
