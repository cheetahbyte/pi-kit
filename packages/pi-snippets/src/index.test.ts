import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult, SessionEntry, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import snippetsExtension from "./index.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function harness(settings: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pi-snippets-ui-"));
  directories.push(directory);
  const snippetsDirectory = join(directory, "snippets");
  const settingsPath = join(directory, "settings.json");
  mkdirSync(snippetsDirectory);
  for (const [index, [file, placement, body]] of [
    ["before.md", "before", "Before"],
    ["after.md", "after", "After"],
    ["once.md", "after", "Once"],
  ].entries()) {
    writeFileSync(join(snippetsDirectory, file), `---\nname: ${body}\nplacement: ${placement}\norder: ${index}\n---\n${body}\n`);
  }
  writeFileSync(settingsPath, JSON.stringify(settings));
  let entries: SessionEntry[] = [];
  let keys: string[] = [];
  let rendered = "";
  let widget: string[] | undefined;
  const notifications: string[] = [];
  const confirmations: string[] = [];
  let resetConfirmed = false;
  const handlers: Record<string, (...args: any[]) => any> = {};
  let menu: (...args: any[]) => any;
  const api = {
    on(name: string, handler: (...args: any[]) => any) { handlers[name] = handler; },
    registerCommand(_name: string, options: { handler: (...args: any[]) => any }) { menu = options.handler; },
    registerShortcut() {},
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data, id: String(entries.length), parentId: null, timestamp: "" });
    },
  } as unknown as ExtensionAPI;
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const ctx = {
    hasUI: true,
    mode: "tui",
    sessionManager: { getEntries: () => entries },
    ui: {
      theme,
      notify(text: string) { notifications.push(text); },
      async confirm(title: string, message: string) { confirmations.push(`${title}\n${message}`); return resetConfirmed; },
      setWidget(_id: string, lines: string[] | undefined) { widget = lines; },
      async custom(factory: (...args: any[]) => any) {
        let result: unknown;
        const component = await factory({ terminal: { rows: 24 }, requestRender() {} }, theme, {}, (value: unknown) => { result = value; });
        for (const key of keys) {
          component.handleInput(key);
          rendered = component.render(120).join("\n");
          expect(component.render(35).every((line: string) => visibleWidth(line) <= 35)).toBe(true);
        }
        return result;
      },
    },
  } as unknown as ExtensionContext;
  const start = (reason: SessionStartEvent["reason"] = "startup", history: SessionEntry[] = entries) => {
    entries = history;
    snippetsExtension(api, { snippetsDirectory, settingsPath });
    handlers.session_start({ type: "session_start", reason }, ctx);
  };
  start();
  return {
    settingsPath, snippetsDirectory, notifications, confirmations, start,
    confirmReset() { resetConfirmed = true; },
    backups() { return readdirSync(dirname(settingsPath)).filter((name) => name.endsWith(".bak")).map((name) => join(dirname(settingsPath), name)); },
    get widget() { return widget?.join("\n") ?? ""; },
    get rendered() { return rendered; },
    get entries() { return entries; },
    async menu(inputKeys: string[]) { keys = inputKeys; await menu!("", ctx); },
    input(text: string, options: Partial<InputEvent> = {}, record = true) {
      const event: InputEvent = { type: "input", text, source: "interactive", ...options };
      const result = handlers.input(event, ctx) as InputEventResult | undefined;
      if (record) entries.push({ type: "message", id: String(entries.length), parentId: null, timestamp: "", message: { role: "user", content: text, timestamp: 0 } });
      return result;
    },
  };
}

const down = "\x1b[B";
const enter = "\r";
const escape = "\x1b";

test("mixes per-snippet modes, keeps placement and images, and consumes only next-message modes", async () => {
  const h = harness({ "before.md": "first", "after.md": "every" });
  await h.menu([down, down, " ", enter]);
  const images = [{ type: "image" as const, data: "data", mimeType: "image/png" }];
  expect(h.input("hello", { images })).toEqual({ action: "transform", text: "Before\n\nhello\n\nAfter\n\nOnce", images });
  expect(h.input("again")).toMatchObject({ action: "transform", text: "again\n\nAfter" });
  expect(h.widget).toContain("next session");
  expect(h.widget).toContain("Every message");
  expect(h.widget).not.toContain("Once");
  h.start("new", []);
  expect(h.input("new")).toMatchObject({ text: "Before\n\nnew\n\nAfter" });
});

test("cycles all modes, saves automatic modes, and discards cancelled changes", async () => {
  const h = harness();
  await h.menu([" ", " ", enter]);
  expect(JSON.parse(readFileSync(h.settingsPath, "utf8"))).toEqual({ "before.md": "first" });
  expect(h.rendered).toContain("First message");
  await h.menu([" ", "\t", escape, escape]);
  expect(h.rendered).toContain("Every message");
  expect(JSON.parse(readFileSync(h.settingsPath, "utf8"))).toEqual({ "before.md": "first" });
  await h.menu([" ", enter]);
  h.start("reload");
  expect(h.input("one")).toMatchObject({ text: "Before\n\none" });
  expect(h.input("two")).toMatchObject({ text: "Before\n\ntwo" });
  await h.menu([" ", enter]);
  expect(h.input("off")).toBeUndefined();
  expect(JSON.parse(readFileSync(h.settingsPath, "utf8"))).toEqual({});
});

test("reload and resume never replay the first submission, even without a recorded user message", () => {
  const h = harness({ "before.md": "first" });
  expect(h.input("first", {}, false)).toMatchObject({ text: "Before\n\nfirst" });
  h.start("reload");
  expect(h.input("second")).toBeUndefined();
  for (const reason of ["resume", "fork"] as const) {
    h.start(reason, []);
    expect(h.input("continued", {}, false)).toBeUndefined();
    h.start("reload");
    expect(h.input("reloaded", {}, false)).toBeUndefined();
  }
});

test("existing user history prevents first-message application at startup or after tree navigation", () => {
  const h = harness({ "before.md": "first", "after.md": "every" });
  h.input("old");
  const userHistory = h.entries.filter((entry) => entry.type === "message");
  h.start("startup", userHistory);
  expect(h.input("resumed")).toMatchObject({ text: "resumed\n\nAfter" });
  h.start("reload", userHistory);
  expect(h.input("branched")).toMatchObject({ text: "branched\n\nAfter" });
});

test("first-message mode selected after an unmodified input waits for a new session", async () => {
  const h = harness();
  expect(h.input("plain", {}, false)).toBeUndefined();
  h.start("reload");
  await h.menu([" ", " ", enter]);
  expect(h.input("too late")).toBeUndefined();
  h.start("new", []);
  expect(h.input("fresh")).toMatchObject({ text: "Before\n\nfresh" });
});

test("extension input does not consume modes; RPC and queued user inputs do", async () => {
  const h = harness({ "before.md": "first", "after.md": "every" });
  await h.menu([down, down, " ", enter]);
  expect(h.input("automatic", { source: "extension" }, false)).toBeUndefined();
  expect(h.input("rpc", { source: "rpc" }, false)).toMatchObject({ text: "Before\n\nrpc\n\nAfter\n\nOnce" });
  expect(h.input("queued", { streamingBehavior: "followUp" }, false)).toMatchObject({ text: "queued\n\nAfter" });
  expect(h.input("steer", { streamingBehavior: "steer" }, false)).toMatchObject({ text: "steer\n\nAfter" });
});

test("missing snippets are ignored without deleting their saved modes", async () => {
  const h = harness({ "before.md": "first", "after.md": "every", "missing.md": "every" });
  rmSync(join(h.snippetsDirectory, "after.md"));
  await h.menu([enter]);
  expect(h.input("hello")).toMatchObject({ text: "Before\n\nhello" });
  expect(JSON.parse(readFileSync(h.settingsPath, "utf8"))).toEqual({ "before.md": "first", "after.md": "every", "missing.md": "every" });
});

test("declining invalid-settings recovery preserves the file and current selection", async () => {
  const h = harness({ "before.md": "every" });
  writeFileSync(h.settingsPath, "{broken");
  await h.menu([" ", enter]);
  expect(h.confirmations).toHaveLength(1);
  expect(h.backups()).toEqual([]);
  expect(h.input("still active")).toMatchObject({ text: "Before\n\nstill active" });
  expect(readFileSync(h.settingsPath, "utf8")).toBe("{broken");
  h.start("reload");
  expect(h.notifications.join("\n")).toContain("load");
  expect(h.input("disabled")).toBeUndefined();
});

test("the menu can recover invalid settings after confirmation and preserves an exact backup", async () => {
  for (const invalid of ["{broken", '{"before.md":"unknown"}', "null", "[]"]) {
    const h = harness();
    writeFileSync(h.settingsPath, invalid);
    h.start("reload");
    h.confirmReset();
    await h.menu([" ", " ", " ", enter]);
    expect(h.confirmations).toHaveLength(1);
    expect(JSON.parse(readFileSync(h.settingsPath, "utf8"))).toEqual({ "before.md": "every" });
    expect(h.backups()).toHaveLength(1);
    expect(readFileSync(h.backups()[0], "utf8")).toBe(invalid);
    expect(h.notifications.join("\n")).toContain(h.backups()[0]);
    h.start("reload");
    expect(h.input("recovered")).toMatchObject({ text: "Before\n\nrecovered" });
  }
});

test("filesystem read errors remain visible and never offer a settings reset", async () => {
  const h = harness({ "before.md": "every" });
  rmSync(h.settingsPath);
  mkdirSync(h.settingsPath);
  h.confirmReset();
  await h.menu([" ", enter]);
  expect(h.confirmations).toEqual([]);
  expect(h.backups()).toEqual([]);
  expect(h.notifications.join("\n")).toContain("Could not save");
  expect(h.input("unchanged")).toMatchObject({ text: "Before\n\nunchanged" });
});
