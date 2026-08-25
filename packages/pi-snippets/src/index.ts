import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSettingsListTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, type SettingItem } from "@earendil-works/pi-tui";
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
    const active = snippets.filter(({ id }) => enabled.has(id));
    ctx.ui.setWidget(
      widgetId,
      active.length ? [ctx.ui.theme.fg("accent", `snippets: ${active.map(({ name }) => name).join(" · ")}`)] : undefined,
    );
  };

  const openMenu = async (ctx: ExtensionContext): Promise<void> => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Snippets require interactive mode", "warning");
      return;
    }

    refresh();
    if (!snippets.length) {
      ctx.ui.notify(`No snippets found in ${snippetsDirectory}`, "warning");
      return;
    }

    await ctx.ui.custom((_tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold("Prompt snippets")), 1, 1));

      const items: SettingItem[] = snippets.map((snippet) => ({
        id: snippet.id,
        label: snippet.name,
        description: `${snippet.placement} · ${snippet.description}`,
        currentValue: enabled.has(snippet.id) ? "on" : "off",
        values: ["on", "off"],
      }));
      const list = new SettingsList(
        items,
        Math.min(items.length + 2, 15),
        getSettingsListTheme(),
        (id, value) => {
          if (value === "on") enabled.add(id);
          else enabled.delete(id);
          updateWidget(ctx);
        },
        () => done(undefined),
        { enableSearch: true },
      );
      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "Enter toggle · Esc apply · selections reset after send"), 1, 1));

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => list.handleInput?.(data),
      };
    });
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

  pi.registerShortcut("alt+s", {
    description: "Toggle prompt snippets",
    handler: openMenu,
  });
}
