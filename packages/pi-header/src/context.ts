import { AgentSession, type ResourceLoader } from "@earendil-works/pi-coding-agent";

const PATCH_STATE = Symbol.for("@cheetahbyte/pi-header/resource-source-capture");
type BindExtensions = AgentSession["bindExtensions"];
type Reload = AgentSession["reload"];
type PatchState = {
  pathsBySession: WeakMap<object, readonly string[]>;
  unsupportedWarningShown: boolean;
  originalBindExtensions: BindExtensions;
  originalReload: Reload;
};
type AgentSessionPrototype = typeof AgentSession.prototype & { [PATCH_STATE]?: PatchState };

function patchState(): PatchState | undefined {
  return (AgentSession.prototype as AgentSessionPrototype)[PATCH_STATE];
}

function warnUnsupported(state: PatchState, error: unknown): void {
  if (state.unsupportedWarningShown) return;
  state.unsupportedWarningShown = true;
  const detail = error instanceof Error ? `: ${error.message}` : "";
  console.warn(`[pi-header] Pi resource source capture unavailable${detail}; Context row omitted.`);
}

function isResourceLoader(value: unknown): value is ResourceLoader {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof ResourceLoader, unknown>>;
  const names: Array<keyof ResourceLoader> = [
    "getSystemPromptSource",
    "getAppendSystemPromptSources",
    "getAgentsFiles",
    "reload",
  ];
  return names.every((name) => typeof candidate[name] === "function");
}

function sourcePaths(loader: ResourceLoader): readonly string[] {
  const system = loader.getSystemPromptSource();
  const append = loader.getAppendSystemPromptSources();
  const agents = loader.getAgentsFiles().agentsFiles;
  const paths = [
    ...(system ? [system.path] : []),
    ...append.map(({ path }) => path),
    ...agents.map(({ path }) => path),
  ];
  if (paths.some((path) => typeof path !== "string")) {
    throw new Error("Pi returned a non-string resource source path");
  }
  return paths;
}

function capture(state: PatchState, session: AgentSession): void {
  try {
    const loader: unknown = session.resourceLoader;
    if (!isResourceLoader(loader)) throw new Error("AgentSession.resourceLoader lacks source metadata");
    state.pathsBySession.set(session.sessionManager, sourcePaths(loader));
  } catch (error) {
    state.pathsBySession.delete(session.sessionManager);
    warnUnsupported(state, error);
  }
}

export function installAgentSessionResourceCapture(): void {
  const prototype = AgentSession.prototype as AgentSessionPrototype;
  if (prototype[PATCH_STATE]) return;

  const state: PatchState = {
    pathsBySession: new WeakMap(),
    unsupportedWarningShown: false,
    originalBindExtensions: prototype.bindExtensions,
    originalReload: prototype.reload,
  };
  Object.defineProperty(prototype, PATCH_STATE, { configurable: false, enumerable: false, value: state });

  prototype.bindExtensions = function (this: AgentSession, ...args) {
    capture(state, this);
    return state.originalBindExtensions.apply(this, args);
  };

  prototype.reload = function (this: AgentSession, ...args) {
    state.pathsBySession.delete(this.sessionManager);
    const loader: unknown = this.resourceLoader;
    if (!isResourceLoader(loader)) {
      state.pathsBySession.delete(this.sessionManager);
      warnUnsupported(state, new Error("AgentSession.resourceLoader lacks reload"));
      return state.originalReload.apply(this, args);
    }

    const originalLoaderReload = loader.reload;
    const wrappedLoaderReload: ResourceLoader["reload"] = function (this: ResourceLoader, ...reloadArgs) {
      return originalLoaderReload.apply(this, reloadArgs).then((value) => {
        capture(state, session);
        return value;
      });
    };
    const session = this;
    try {
      loader.reload = wrappedLoaderReload;
      const result = state.originalReload.apply(this, args);
      return result.finally(() => {
        if (loader.reload === wrappedLoaderReload) loader.reload = originalLoaderReload;
      });
    } catch (error) {
      if (loader.reload === wrappedLoaderReload) loader.reload = originalLoaderReload;
      throw error;
    }
  };
}

export function loadedContextPaths(sessionManager: object): string[] {
  const state = patchState();
  return [...(state?.pathsBySession.get(sessionManager) ?? [])];
}

installAgentSessionResourceCapture();
