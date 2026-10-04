import { calculateCost } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFastProvider } from "./provider.js";

export default function (pi: ExtensionAPI): void {
  const base = builtinProviders().find(provider => provider.id === "openai-codex");
  if (!base) throw new Error("Pi's built-in Codex provider is unavailable");
  const provider = createFastProvider(base);
  const aliases = new Set(provider.getModels()
    .filter(model => !base.getModels().some(original => original.id === model.id))
    .map(model => model.id));
  pi.registerProvider(provider);

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
