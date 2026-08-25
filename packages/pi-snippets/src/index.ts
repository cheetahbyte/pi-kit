import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { loadSnippets, type Snippet } from "./snippets.js";

const snippetsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "snippets");
const widgetId = "pi-snippets";

export default function (pi: ExtensionAPI): void {
  let snippets: Snippet[] = [];
  let enabled = new Set<string>();

  const refresh = (): void => {
    snippets = loadSnippets(snippetsDirectory);
    enabled = new Set([...enabled].filter((id) => snippets.some((snippet) => snippet.id === id)));
  };

  const updateWidget = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const active = snippets.filter(({ id }) => enabled.has(id));
    const before = active.filter(({ placement }) => placement === "before");
    const after = active.filter(({ placement }) => placement === "after");
    const lines = [
      ...(before.length ? [ctx.ui.theme.fg("accent", `↑ before: ${before.map(({ name }) => name).join(" · ")}`)] : []),
      ...(after.length ? [ctx.ui.theme.fg("warning", `↓ after: ${after.map(({ name }) => name).join(" · ")}`)] : []),
    ];
    ctx.ui.setWidget(widgetId, lines.length ? lines : undefined);
  };

  const openMenu = async (ctx: ExtensionContext): Promise<void> => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Snippets require interactive mode", "warning");
      return;
    }

    refresh();
    if (!snippets.length) {
      ctx.ui.notify(`No snippets found in ${snippetsDirectory}`, "warning");
      updateWidget(ctx);
      return;
    }

    const working = new Set(enabled);
    const confirmed = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
      const before = snippets.filter(({ placement }) => placement === "before");
      const after = snippets.filter(({ placement }) => placement === "after");
      const items = [...before, ...after];
      let mode: "list" | "preview" = "list";
      let cursor = 0;
      let listScroll = 0;
      let previewScroll = 0;

      const viewport = (lines: string[], scroll: number, maxView: number, focusRow?: number) => {
        const clipped = lines.length > maxView;
        const view = clipped ? Math.max(1, maxView - 2) : maxView;
        let nextScroll = Math.min(Math.max(0, scroll), Math.max(0, lines.length - view));
        if (focusRow !== undefined) {
          if (focusRow < nextScroll) nextScroll = focusRow;
          else if (focusRow >= nextScroll + view) nextScroll = focusRow - view + 1;
        }
        const visible = lines.slice(nextScroll, nextScroll + view);
        return {
          lines: clipped
            ? [
                nextScroll ? theme.fg("dim", ` ↑ ${nextScroll} more`) : "",
                ...visible,
                nextScroll + view < lines.length ? theme.fg("dim", ` ↓ ${lines.length - nextScroll - view} more`) : "",
              ]
            : visible,
          scroll: nextScroll,
        };
      };

      return {
        render(width: number): string[] {
          const maxView = Math.max(5, tui.terminal.rows - 10);
          let content: string[];
          let title: string;
          let hints: string;

          if (mode === "list") {
            const rows: Array<{ text: string; item?: number }> = [
              { text: theme.fg("dim", "↑ BEFORE — added before your message") },
              ...before.map((snippet, item) => ({
                item,
                text: `${item === cursor ? theme.fg("accent", "> ") : "  "}${working.has(snippet.id) ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]")} ${theme.bold(snippet.name)}${snippet.description ? theme.fg("dim", ` — ${snippet.description}`) : ""}`,
              })),
              { text: "" },
              { text: theme.fg("dim", "↓ AFTER — added after your message") },
              ...after.map((snippet, index) => {
                const item = before.length + index;
                return {
                  item,
                  text: `${item === cursor ? theme.fg("accent", "> ") : "  "}${working.has(snippet.id) ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]")} ${theme.bold(snippet.name)}${snippet.description ? theme.fg("dim", ` — ${snippet.description}`) : ""}`,
                };
              }),
            ];
            const view = viewport(rows.map(({ text }) => truncateToWidth(text, width)), listScroll, maxView, rows.findIndex(({ item }) => item === cursor));
            content = view.lines;
            listScroll = view.scroll;
            title = "Prompt snippets";
            hints = "↑↓ navigate • Space toggle • Tab preview • Enter apply • Esc cancel";
          } else {
            const snippet = items[cursor];
            const rows = [
              theme.bold(snippet.name),
              theme.fg("dim", `${snippet.placement} · order ${snippet.order} · ${snippet.id}`),
              theme.fg("dim", "─".repeat(Math.min(width, 40))),
              ...snippet.body.split("\n").flatMap((line) => wrapTextWithAnsi(line, width)),
            ].map((line) => truncateToWidth(line, width));
            const view = viewport(rows, previewScroll, maxView);
            content = view.lines;
            previewScroll = view.scroll;
            title = `Preview: ${snippet.name}`;
            hints = "↑↓ scroll • Tab/Esc back";
          }

          return [
            theme.fg("accent", "─".repeat(width)),
            truncateToWidth(` ${theme.fg("accent", theme.bold(title))}`, width),
            "",
            ...content,
            "",
            truncateToWidth(theme.fg("dim", ` ${hints}`), width),
            theme.fg("accent", "─".repeat(width)),
          ];
        },
        invalidate() {},
        handleInput(data: string): void {
          if (mode === "list") {
            if (matchesKey(data, Key.up)) cursor = (cursor - 1 + items.length) % items.length;
            else if (matchesKey(data, Key.down)) cursor = (cursor + 1) % items.length;
            else if (matchesKey(data, Key.space)) {
              const id = items[cursor].id;
              if (working.has(id)) working.delete(id);
              else working.add(id);
            } else if (matchesKey(data, Key.tab)) {
              mode = "preview";
              previewScroll = 0;
            } else if (matchesKey(data, Key.enter)) return done(true);
            else if (matchesKey(data, Key.escape)) return done(false);
            else return;
          } else if (matchesKey(data, Key.up)) previewScroll--;
          else if (matchesKey(data, Key.down)) previewScroll++;
          else if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) mode = "list";
          else return;
          tui.requestRender();
        },
      };
    });

    if (confirmed) enabled = working;
    updateWidget(ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    mkdirSync(snippetsDirectory, { recursive: true });
    enabled.clear();
    refresh();
    updateWidget(ctx);
  });

  pi.on("input", (event, ctx) => {
    if (!enabled.size) return;

    refresh();
    const active = snippets.filter(({ id }) => enabled.has(id));
    enabled.clear();
    updateWidget(ctx);
    if (!active.length) return;

    return {
      action: "transform",
      text: [
        ...active.filter(({ placement }) => placement === "before").map(({ body }) => body),
        event.text,
        ...active.filter(({ placement }) => placement === "after").map(({ body }) => body),
      ].join("\n\n"),
    };
  });

  pi.registerCommand("snippets", {
    description: "Toggle one-shot prompt snippets",
    handler: async (_args, ctx) => openMenu(ctx),
  });

  pi.registerShortcut("ctrl+r", {
    description: "Toggle prompt snippets",
    handler: openMenu,
  });
}
