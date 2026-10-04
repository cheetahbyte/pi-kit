import type { Api, Model, ModelCost, Provider, ProviderRequestOptions } from "@earendil-works/pi-ai";

export function fastCost(cost: ModelCost): ModelCost {
  return {
    ...cost,
    input: cost.input * 2,
    output: cost.output * 2,
    cacheRead: cost.cacheRead * 2,
    cacheWrite: cost.cacheWrite * 2,
    ...(cost.tiers ? { tiers: cost.tiers.map(tier => ({ ...tier, ...fastCost(tier) })) } : {}),
  };
}

export function createFastProvider(base: Provider): Provider {
  const originals = new Map<string, Model<Api>>();
  const getModels = (): readonly Model<Api>[] => {
    const models = base.getModels();
    const ids = new Set(models.map(model => model.id));
    originals.clear();
    const aliases = models.filter(model => model.api === "openai-codex-responses"
      && !model.id.endsWith("-fast") && !ids.has(`${model.id}-fast`)).map(model => {
      const id = `${model.id}-fast`;
      originals.set(id, model);
      return { ...model, id, name: `${model.name} Fast`, cost: fastCost(model.cost) };
    });
    return [...models, ...aliases];
  };
  getModels();

  const optionsFor = <T extends ProviderRequestOptions>(model: Model<Api>, options: T): T => {
    const original = originals.get(model.id);
    if (!original) return options;
    return {
      ...options,
      onPayload: async (payload, requestModel) => {
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          throw new Error("Unexpected Codex request payload");
        }
        const rewritten = { ...payload, model: original.id, service_tier: "priority" };
        return await options.onPayload?.(rewritten, requestModel) ?? rewritten;
      },
    };
  };

  return {
    ...base,
    getModels,
    getAllModels: () => [
      ...(base.getAllModels?.().filter(model => model.type !== "chat") ?? []),
      ...getModels(),
    ],
    ...(base.filterModels ? {
      filterModels(models, credential) {
        const accepted = new Set(base.filterModels!(base.getModels(), credential).map(model => model.id));
        return models.filter(model => accepted.has(originals.get(model.id)?.id ?? model.id));
      },
    } : {}),
    stream: (model, context, options) => base.stream(model, context, optionsFor(model, options ?? {}) as typeof options),
    streamSimple: (model, context, options) => base.streamSimple(model, context, optionsFor(model, options ?? {})),
  };
}
