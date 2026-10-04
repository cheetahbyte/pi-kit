import { calculateCost } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFastProvider } from "./provider.js";

const stateType = "pi-codex-fast";

export default function (pi: ExtensionAPI): void {
  const base = builtinProviders().find(provider => provider.id === "openai-codex");
  if (!base) throw new Error("Pi's built-in Codex provider is unavailable");
  const provider = createFastProvider(base);
  const aliases = new Set(provider.getModels()
    .filter(model => !base.getModels().some(original => original.id === model.id))
    .map(model => model.id));
  pi.registerProvider(provider);

  const updateStatus = (ctx: ExtensionContext): void => {
    const value = ctx.model?.provider === "openai-codex" && aliases.has(ctx.model.id) ? "⚡ fast" : null;
    pi.events.emit("pi-footer:update-widget", { widgetId: "codex-fast", value });
    if (ctx.hasUI) ctx.ui.setStatus(stateType, value ?? undefined);
  };

  pi.on("session_start", (_event, ctx) => updateStatus(ctx));
  pi.on("session_tree", (_event, ctx) => updateStatus(ctx));
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    pi.events.emit("pi-footer:update-widget", { widgetId: "codex-fast", value: null });
    if (ctx.hasUI) ctx.ui.setStatus(stateType, undefined);
  });

  pi.on("message_end", ({ message }, ctx) => {
    if (message.role !== "assistant" || message.provider !== "openai-codex"
      || !aliases.has(message.model)) return;
    const model = ctx.modelRegistry.find(message.provider, message.model);
    if (!model) return;
    const usage = { ...message.usage, cost: { ...message.usage.cost } };
    calculateCost(model, usage);
    return { message: { ...message, usage } };
  });
}
