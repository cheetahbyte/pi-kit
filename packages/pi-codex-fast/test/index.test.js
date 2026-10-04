import { expect, test } from "bun:test";
import extension from "../src/index.ts";
import { createFastProvider } from "../src/provider.ts";

const model = {
  id: "gpt-example", name: "Example", provider: "openai-codex", api: "openai-codex-responses",
  reasoning: true, input: ["text", "image"], contextWindow: 100000, maxTokens: 10000,
  cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2,
    tiers: [{ inputTokensAbove: 100000, input: 4, output: 20, cacheRead: 0.4, cacheWrite: 4 }] },
};

function setup() {
  const calls = [];
  const stream = (selected, context, options) => {
    calls.push({ selected, context, options });
    return "stream";
  };
  const base = { id: "openai-codex", name: "Codex", auth: { oauth: {} },
    getModels: () => [model], stream, streamSimple: stream };
  return { base, provider: createFastProvider(base), calls };
}

test("aliases preserve originals, capabilities, and OAuth while doubling all price tiers", () => {
  const { base, provider } = setup();
  const [original, fast] = provider.getModels();
  expect(original).toBe(model);
  expect(provider.auth).toBe(base.auth);
  expect(fast).toMatchObject({ ...model, id: "gpt-example-fast", name: "Example Fast",
    cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 4,
      tiers: [{ inputTokensAbove: 100000, input: 8, output: 40, cacheRead: 0.8, cacheWrite: 8 }] } });
});

for (const method of ["stream", "streamSimple"]) {
  test(`${method} sends original model and priority, preserving request hooks`, async () => {
    const { provider, calls } = setup();
    const alias = provider.getModels()[1];
    const context = { messages: [] };
    let observed;
    const signal = new AbortController().signal;
    expect(provider[method](alias, context, { signal,
      onPayload: (payload) => { observed = payload; return { ...payload, extra: true }; },
    })).toBe("stream");
    const call = calls[0];
    expect(call.selected.id).toBe("gpt-example-fast");
    expect(call.options.signal).toBe(signal);
    const payload = await call.options.onPayload({ model: alias.id, reasoning: { effort: "high" } }, alias);
    expect(observed).toEqual({ model: model.id, service_tier: "priority", reasoning: { effort: "high" } });
    expect(payload).toEqual({ ...observed, extra: true });
    expect(call.context).toBe(context);
  });
}

test("normal models retain their stream options unchanged", () => {
  const { provider, calls } = setup();
  const options = { onPayload() {} };
  provider.streamSimple(model, { messages: [] }, options);
  expect(calls[0].options).toBe(options);
});

test("existing fast IDs are not overwritten or duplicated", () => {
  const { base } = setup();
  const existing = { ...model, id: "gpt-example-fast" };
  base.getModels = () => [model, existing];
  expect(createFastProvider(base).getModels()).toEqual([model, existing]);
});

test("provider credential filtering applies to aliases too", () => {
  const { base } = setup();
  base.filterModels = () => [];
  const provider = createFastProvider(base);
  expect(provider.filterModels(provider.getModels(), undefined)).toEqual([]);
});

function extensionSetup() {
  const handlers = new Map();
  const widgets = [];
  let provider;
  extension({
    registerProvider: value => { provider = value; },
    on: (name, handler) => handlers.set(name, handler),
    events: { emit: (event, payload) => widgets.push({ event, payload }) },
  });
  const models = provider.getModels();
  const ctx = { model: models.find(model => model.id.endsWith("-fast")), hasUI: true,
    ui: { setStatus() {} },
    modelRegistry: { find: (provider, id) => models.find(model => model.provider === provider && model.id === id) },
  };
  return { handlers, widgets, ctx, models };
}

test("extension registers no footer or native status handlers", () => {
  const { handlers, widgets } = extensionSetup();
  expect([...handlers.keys()]).toEqual(["message_end"]);
  expect(widgets).toEqual([]);
});

test("message pricing uses alias rates rather than stacking provider multipliers", () => {
  const { handlers, ctx } = extensionSetup();
  const message = { role: "assistant", provider: ctx.model.provider, api: ctx.model.api, model: ctx.model.id,
    usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
      cost: { input: 999, output: 0, cacheRead: 0, cacheWrite: 0, total: 999 } },
  };
  const result = handlers.get("message_end")({ message }, ctx);
  expect(result.message.usage.cost.total).toBe(ctx.model.cost.input / 1000000);
  expect(message.usage.cost.total).toBe(999);
});
