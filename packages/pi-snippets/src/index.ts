import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { InvalidSnippetSettingsError, loadSnippetModes, loadSnippets, saveSnippetModes, type Snippet, type SnippetMode } from "./snippets.js";

const defaultSnippetsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "snippets");
const widgetId = "pi-snippets";
const firstMessageEntry = "pi-snippets-first-message";
const modeLabels = { next: "Next message", first: "First message", every: "Every message" };
const modeCycle = [undefined, "next", "first", "every"] as const;

export default function (pi: ExtensionAPI, {
  snippetsDirectory = defaultSnippetsDirectory,
  settingsPath = join(getAgentDir(), "snippets.json"),
} = {}): void {
  let snippets: Snippet[] = [];
  let modes = new Map<string, SnippetMode>();
  let firstMessage = false;

  const refresh = (): void => {
    snippets = loadSnippets(snippetsDirectory);
  };

  const describeMode = (id: string, selection = modes): string => {
    const mode = selection.get(id);
    return mode === "first" && !firstMessage ? "First message · next session" : mode ? modeLabels[mode] : "Off";
  };

  const markStarted = (): void => {
    pi.appendEntry(firstMessageEntry, {});
    firstMessage = false;
  };

  const updateWidget = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const active = snippets.filter(({ id }) => modes.has(id));
    const before = active.filter(({ placement }) => placement === "before");
    const after = active.filter(({ placement }) => placement === "after");
    const label = ({ id, name }: Snippet) => `${name} [${describeMode(id)}]`;
    const lines = [
      ...(before.length ? [ctx.ui.theme.fg("accent", `↑ before: ${before.map(label).join(" · ")}`)] : []),
      ...(after.length ? [ctx.ui.theme.fg("warning", `↓ after: ${after.map(label).join(" · ")}`)] : []),
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

    const working = new Map(modes);
    const confirmed = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
      const before = snippets.filter(({ placement }) => placement === "before");
      const after = snippets.filter(({ placement }) => placement === "after");
      const items = [...before, ...after];
      let mode: "list" | "preview" = "list";
      let cursor = 0;
      let listScroll = 0;
      let previewScroll = 0;

      const itemText = (snippet: Snippet, item: number): string =>
        `${item === cursor ? theme.fg("accent", "> ") : "  "}${theme.fg(working.has(snippet.id) ? "success" : "dim", `[${describeMode(snippet.id, working)}]`)} ${theme.bold(snippet.name)}${snippet.description ? theme.fg("dim", ` — ${snippet.description}`) : ""}`;

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
              ...before.map((snippet, item) => ({ item, text: itemText(snippet, item) })),
              { text: "" },
              { text: theme.fg("dim", "↓ AFTER — added after your message") },
              ...after.map((snippet, index) => {
                const item = before.length + index;
                return { item, text: itemText(snippet, item) };
              }),
            ];
            const view = viewport(rows.map(({ text }) => truncateToWidth(text, width)), listScroll, maxView, rows.findIndex(({ item }) => item === cursor));
            content = view.lines;
            listScroll = view.scroll;
            title = "Prompt snippets";
            hints = "↑↓ navigate • Space cycle mode • Tab preview • Enter apply • Esc cancel";
          } else {
            const snippet = items[cursor];
            const rows = [
              theme.bold(snippet.name),
              theme.fg("dim", `${describeMode(snippet.id, working)} · ${snippet.placement} · order ${snippet.order} · ${snippet.id}`),
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
              const next = modeCycle[(modeCycle.indexOf(working.get(id)) + 1) % modeCycle.length];
              if (next) working.set(id, next);
              else working.delete(id);
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

    if (confirmed) {
      try {
        try {
          saveSnippetModes(settingsPath, working);
        } catch (error) {
          if (!(error instanceof InvalidSnippetSettingsError)) throw error;
          const reset = await ctx.ui.confirm(
            "Reset invalid snippet settings?",
            `${error.message}\nBack up ${settingsPath} and replace it with your current menu selections?`,
          );
          if (!reset) {
            updateWidget(ctx);
            return;
          }
          const backup = saveSnippetModes(settingsPath, working, true);
          if (backup) ctx.ui.notify(`Previous snippet settings backed up to ${backup}`, "info");
        }
        modes = working;
      } catch (error) {
        ctx.ui.notify(`Could not save snippet settings: ${error}`, "error");
      }
    }
    updateWidget(ctx);
  };

  pi.on("session_start", (event, ctx) => {
    mkdirSync(snippetsDirectory, { recursive: true });
    modes = new Map();
    try {
      modes = loadSnippetModes(settingsPath);
    } catch (error) {
      ctx.ui.notify(`Could not load snippet settings: ${error}`, "error");
    }
    firstMessage = !ctx.sessionManager.getEntries().some((entry) =>
      (entry.type === "message" && entry.message.role === "user") ||
      (entry.type === "custom" && entry.customType === firstMessageEntry),
    );
    if (firstMessage && (event.reason === "resume" || event.reason === "fork")) markStarted();
    refresh();
    updateWidget(ctx);
  });

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return;

    const isFirstMessage = firstMessage;
    if (firstMessage) markStarted();
    refresh();
    const active = snippets.filter(({ id }) => {
      const mode = modes.get(id);
      return mode === "next" || mode === "every" || (mode === "first" && isFirstMessage);
    });
    for (const { id } of active) {
      if (modes.get(id) === "next") modes.delete(id);
    }
    updateWidget(ctx);
    if (!active.length) return;

    return {
      action: "transform",
      images: event.images,
      text: [
        ...active.filter(({ placement }) => placement === "before").map(({ body }) => body),
        event.text,
        ...active.filter(({ placement }) => placement === "after").map(({ body }) => body),
      ].join("\n\n"),
    };
  });

  pi.registerCommand("snippets", {
    description: "Configure per-snippet application modes",
    handler: async (_args, ctx) => openMenu(ctx),
  });

  pi.registerShortcut("ctrl+alt+p", {
    description: "Configure prompt snippets",
    handler: openMenu,
  });
}
