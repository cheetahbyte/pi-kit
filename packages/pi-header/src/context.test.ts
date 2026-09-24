import { expect, test } from "bun:test";
import { AgentSession, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { installAgentSessionResourceCapture, loadedContextPaths } from "./context.js";

type FakeSession = {
  resourceLoader: ResourceLoader;
  _resourceLoader: ResourceLoader;
  settingsManager: { reload: () => Promise<void> };
  sessionManager: object;
  _extensionRunner: {
    hasHandlers: () => boolean;
    getFlagValues: () => Map<string, unknown>;
    invalidate: () => void;
    setUIContext: () => void;
    bindCommandContext: () => void;
    onError: () => () => void;
    emit: () => Promise<void>;
  };
  _extensionUIContext: object;
  _extensionMode: "tui";
  _applyExtensionBindings: () => void;
  syncQueueModesFromSettings: () => void;
  _sessionStartEvent: { type: "session_start"; reason: "startup" };
  _buildRuntime: () => void;
  getActiveToolNames: () => string[];
  extendResourcesFromExtensions: () => Promise<void>;
};

function loader(paths: { system?: string; append: string[]; agents: string[]; reload?: () => Promise<void> }): ResourceLoader {
  return {
    getSystemPromptSource: () => paths.system ? { path: paths.system } : undefined,
    getAppendSystemPromptSources: () => paths.append.map((path) => ({ path })),
    getAgentsFiles: () => ({ agentsFiles: paths.agents.map((path) => ({ path, content: "" })) }),
    reload: paths.reload ?? (async () => {}),
  } as ResourceLoader;
}

function fakeSession(resourceLoader: ResourceLoader): FakeSession {
  return {
    resourceLoader,
    _resourceLoader: resourceLoader,
    settingsManager: { reload: async () => {} },
    sessionManager: {},

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
    syncQueueModesFromSettings: () => {},
    _sessionStartEvent: { type: "session_start", reason: "startup" },
    _buildRuntime: () => {},
    getActiveToolNames: () => [],
    extendResourcesFromExtensions: async () => {},
  };
}

test("captures arbitrary Pi resource source paths during bind and reload", async () => {
  const current = { system: "/custom/system.txt", append: ["/arbitrary/addendum.md"], agents: ["/nested/rules.txt"] };
  const resourceLoader = loader(current);
  const session = fakeSession(resourceLoader);
  await AgentSession.prototype.bindExtensions.call(session as unknown as AgentSession, {});
  expect(loadedContextPaths(session.sessionManager)).toEqual([
    "/custom/system.txt", "/arbitrary/addendum.md", "/nested/rules.txt",
  ]);

  session._extensionUIContext = {};
  resourceLoader.reload = async () => {
    current.system = "/updated/system.txt";
    current.append = ["/updated/append.txt"];
    current.agents = ["/updated/agents.txt"];
  };
  await AgentSession.prototype.reload.call(session as unknown as AgentSession);
  expect(loadedContextPaths(session.sessionManager)).toEqual([
    "/updated/system.txt", "/updated/append.txt", "/updated/agents.txt",
  ]);
});

test("keeps separate session managers separate and install idempotent", async () => {
  const patched = AgentSession.prototype.bindExtensions;
  installAgentSessionResourceCapture();
  const reloaded = await import(`./context.js?reimport=${Date.now()}`);
  expect(AgentSession.prototype.bindExtensions).toBe(patched);
  expect(reloaded.loadedContextPaths).toBeDefined();

  const first = fakeSession(loader({ append: ["/one"], agents: [] }));
  const second = fakeSession(loader({ append: ["/two"], agents: [] }));
  await AgentSession.prototype.bindExtensions.call(first as unknown as AgentSession, {});
  await AgentSession.prototype.bindExtensions.call(second as unknown as AgentSession, {});
  expect(loadedContextPaths(first.sessionManager)).toEqual(["/one"]);
  expect(reloaded.loadedContextPaths(first.sessionManager)).toEqual(["/one"]);
  expect(loadedContextPaths(second.sessionManager)).toEqual(["/two"]);
});

test("preserves original bind behavior and omits unsupported loaders", async () => {
  const session = fakeSession({ reload: async () => {} } as ResourceLoader);
  let emitted = false;
  session._extensionRunner.emit = async () => { emitted = true; };
  await AgentSession.prototype.bindExtensions.call(session as unknown as AgentSession, {});
  expect(emitted).toBe(true);
  expect(loadedContextPaths(session.sessionManager)).toEqual([]);
});
