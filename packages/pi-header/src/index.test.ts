import { expect, test } from "bun:test";
import { AgentSession, type ExtensionAPI, type ExtensionContext, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import headerExtension from "./index.js";

type Header = { render(width: number): string[] };
type HeaderFactory = (tui: unknown, theme: { bold(text: string): string; fg(color: string, text: string): string }) => Header;
type Handler = (...args: unknown[]) => unknown;

test("header renders Pi-reported arbitrary context source paths", async () => {
  const sessionManager = {};
  const resourceLoader = {
    getSystemPromptSource: () => ({ path: "/custom/SYSTEM.md" }),
    getAppendSystemPromptSources: () => [{ path: "/custom/APPEND.any" }],
    getAgentsFiles: () => ({ agentsFiles: [{ path: "/custom/rules.whatever", content: "" }] }),
    reload: async () => {},
  } as ResourceLoader;
  const fakeSession = {
    resourceLoader,
    _resourceLoader: resourceLoader,
    sessionManager,
    _extensionRunner: {
      hasHandlers: () => false,
      getFlagValues: () => new Map(),
      invalidate: () => {},
      setUIContext: () => {},
      bindCommandContext: () => {},
      onError: () => () => {},
      emit: async () => {},
    },
    _extensionUIContext: {},
    _extensionMode: "tui",
    _applyExtensionBindings: () => {},
    _sessionStartEvent: { type: "session_start", reason: "startup" },
    _buildRuntime: () => {},
    getActiveToolNames: () => [],
    extendResourcesFromExtensions: async () => {},
    settingsManager: { reload: async () => {} },
    syncQueueModesFromSettings: () => {},
  };
  await AgentSession.prototype.bindExtensions.call(fakeSession as unknown as AgentSession, {});

  const handlers: Record<string, Handler> = {};
  let headerFactory: HeaderFactory | undefined;
  const theme = { bold: (text: string) => text, fg: (_color: string, text: string) => text };
  const api = {
    on(name: string, handler: Handler) { handlers[name] = handler; },
    getCommands: () => [],
    getAllTools: () => [],
    registerCommand() {},
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui",
    cwd: "/custom",
    sessionManager,
    ui: { setHeader(factory: unknown) { headerFactory = factory as HeaderFactory; } },
  } as unknown as ExtensionContext;

  headerExtension(api);
  handlers.session_start({}, ctx);
  const output = headerFactory!(undefined, theme).render(120).join("\n");
  expect(output).toContain("SYSTEM.md");
  expect(output).toContain("APPEND.any");
  expect(output).toContain("rules.whatever");
});
