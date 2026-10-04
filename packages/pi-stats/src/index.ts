import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { aggregate, scan, type Stats, type Table } from "./stats.js";

const defaultDays = 30;
const tabs = ["Overview", "Models", "Projects", "Tools", "Skills"] as const;
const sparks = "▁▂▃▄▅▆▇█";

const formatTokens = (tokens: number): string =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : `${tokens}`;
const formatCost = (cost: number): string => `$${cost.toFixed(2)}`;

function tableLines(table: Table, sortBy: "cost" | "count", columns: { errors?: boolean; cost?: boolean }): string[] {
  const rows = [...table].sort(([, a], [, b]) => b[sortBy] - a[sortBy] || b.count - a.count);
  if (!rows.length) return ["Nothing recorded in this range."];
  const line = (name: string, count: string, errors: string, cost: string, tokens: string): string =>
    `${truncateToWidth(name, 40).padEnd(40)}${count.padStart(8)}${columns.errors ? errors.padStart(8) : ""}${columns.cost ? cost.padStart(10) + tokens.padStart(8) : ""}`;
  return [
    line("Name", "Calls", "Errors", "Cost", "Tokens"),
    ...rows.map(([name, total]) =>
      line(name.replace(homedir(), "~"), `${total.count}`, `${total.errors}`, formatCost(total.cost), formatTokens(total.input + total.cached + total.output)),
    ),
  ];
}

export function overviewLines({ sessions, total, days }: Stats): string[] {
  const costs = [...days].sort(([a], [b]) => a.localeCompare(b));
  const peak = costs.reduce((best, day) => (day[1] > best[1] ? day : best), ["", 0]);
  const allInput = total.input + total.cached;
  return [
    `Sessions       ${sessions}`,
    `Model calls    ${total.count}`,
    `Cost           ${formatCost(total.cost)}`,
    `Input tokens   ${formatTokens(allInput)} (${allInput ? Math.round((total.cached / allInput) * 100) : 0}% cached)`,
    `Output tokens  ${formatTokens(total.output)}`,
    `Active days    ${costs.length}`,
    ...(peak[1] > 0
      ? ["", `Cost per active day, peak ${formatCost(peak[1])} on ${peak[0]}`, costs.map(([, cost]) => sparks[Math.round((cost / peak[1]) * (sparks.length - 1))]).join("")]
      : []),
  ];
}

export default function (pi: ExtensionAPI, { sessionsDirectory = join(getAgentDir(), "sessions"), cachePath = join(getAgentDir(), "stats-cache.json") } = {}): void {
  pi.registerCommand("stats", {
    description: "Show usage from session history: /stats [days|all]",
    handler: async (args, ctx) => {
      const days = args.trim() === "all" ? 0 : Number.parseInt(args, 10) || defaultDays;
      const since = days ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : "";
      const stats = aggregate(await scan(sessionsDirectory, cachePath), since);
      const range = days ? `last ${days} days` : "all time";
      const views: Record<(typeof tabs)[number], string[]> = {
        Overview: overviewLines(stats),
        Models: tableLines(stats.models, "cost", { cost: true }),
        Projects: tableLines(stats.projects, "cost", { cost: true }),
        Tools: tableLines(stats.tools, "count", { errors: true }),
        Skills: tableLines(stats.skills, "count", {}),
      };

      if (ctx.mode !== "tui") return ctx.ui.notify([`Pi usage, ${range}`, ...views.Overview].join("\n"), "info");

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          let tab = 0;
          let scroll = 0;
          return {
            render(width: number): string[] {
              const view = Math.max(5, tui.terminal.rows - 12);
              const body = views[tabs[tab]];
              scroll = Math.min(Math.max(0, scroll), Math.max(0, body.length - view));
              const rule = theme.fg("accent", "─".repeat(width));
              const header = tabs.map((name, index) => (index === tab ? theme.fg("accent", theme.bold(`[${name}]`)) : theme.fg("dim", ` ${name} `))).join(" ");
              const more = body.length > view ? ` · ↑/↓ scroll (${scroll + 1}-${Math.min(body.length, scroll + view)} of ${body.length})` : "";
              return [
                rule,
                ` ${header}  ${theme.fg("dim", range)}`,
                "",
                ...body.slice(scroll, scroll + view).map((line) => ` ${line}`),
                "",
                theme.fg("dim", ` Tab switch view${more} · Esc close`),
                rule,
              ].map((line) => truncateToWidth(line, width));
            },
            invalidate() {},
            handleInput(data: string): void {
              if (matchesKey(data, Key.escape)) return done();
              if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) tab = (tab + 1) % tabs.length;
              else if (matchesKey(data, Key.left)) tab = (tab - 1 + tabs.length) % tabs.length;
              else if (matchesKey(data, Key.up)) scroll--;
              else if (matchesKey(data, Key.down)) scroll++;
              else return;
              if (!matchesKey(data, Key.up) && !matchesKey(data, Key.down)) scroll = 0;
              tui.requestRender();
            },
          };
        },
        { overlay: true },
      );
    },
  });
}
