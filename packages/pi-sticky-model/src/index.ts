import { getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const modelKey = (model: { provider: string; id: string } | undefined): string | undefined => (model ? `${model.provider}/${model.id}` : undefined);

export default function (pi: ExtensionAPI, { agentDir = getAgentDir() } = {}): void {
  let settings: SettingsManager | undefined;
  let currentModel: string | undefined;
  let switchLevel: string | undefined;

  // Pi's settings manager merges only the changed fields into the file, under a lock. Reloading first keeps edits made elsewhere.
  const save = async (ctx: ExtensionContext, change: (settings: SettingsManager) => void): Promise<SettingsManager> => {
    settings ??= SettingsManager.create(ctx.cwd, agentDir);
    await settings.reload();
    change(settings);
    await settings.flush();
    return settings;
  };

  pi.on("session_start", (_event, ctx) => {
    currentModel = modelKey(ctx.model);
  });

  pi.on("model_select", async (event, ctx) => {
    const { provider, id } = event.model;
    currentModel = modelKey(event.model);
    switchLevel = pi.getThinkingLevel();
    if (event.source === "restore") return;
    const saved = await save(ctx, (manager) => manager.setDefaultModelAndProvider(provider, id));
    // Pi picked a level from the settings it read at startup, which don't include levels saved since then.
    const level = saved.getModelThinkingLevel(provider, id);
    if (level && level !== pi.getThinkingLevel()) pi.setThinkingLevel(level);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    const { model } = ctx;
    // A model switch also changes the level, and that event can arrive before or after model_select. Only a level you picked is saved.
    if (!model || modelKey(model) !== currentModel) return;
    const fromSwitch = event.level === switchLevel;
    switchLevel = undefined;
    if (fromSwitch || event.level !== pi.getThinkingLevel()) return;
    await save(ctx, (manager) => {
      if (manager.getModelThinkingLevel(model.provider, model.id) !== event.level) manager.setModelThinkingLevel(model.provider, model.id, event.level);
    });
  });
}
