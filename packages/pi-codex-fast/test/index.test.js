import { expect, test } from "bun:test";
import extension from "../src/index.ts";

function setup(provider = "openai-codex") {
  const handlers = new Map();
  const commands = new Map();
  const widgets = [];
  const notifications = [];
  const ctx = {
    model: {
      provider, api: "openai-codex-responses", id: "gpt-5.6-sol",
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2 },
    },
    hasUI: true,
    ui: {
      setStatus() {},
      notify: (message, level) => notifications.push({ message, level }),
    },
  };
  extension({
    on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry() {},
    events: { emit: (event, payload) => widgets.push({ event, payload }) },
  });
  return { handlers, commands, widgets, notifications, ctx };
}

test("gpt-5.6-sol enables priority requests and updates pi-footer", async () => {
  const { handlers, commands, widgets, notifications, ctx } = setup();
  await commands.get("fast").handler("on", ctx);
  expect(notifications.some(({ level }) => level === "warning")).toBe(false);
  expect(widgets.at(-1)).toEqual({
    event: "pi-footer:update-widget",
    payload: { widgetId: "codex-fast", value: "Fast: on" },
  });
  const payload = { model: "gpt-5.6-sol", reasoning: { effort: "medium" } };
  const request = handlers.get("before_provider_request");
  expect(request({ payload }, ctx)).toEqual({ ...payload, service_tier: "priority" });
  expect(payload).not.toHaveProperty("service_tier");
  await commands.get("fast").handler("off", ctx);
  expect(request({ payload }, ctx)).toBeUndefined();
  expect(widgets.at(-1).payload.value).toBeNull();
});

function assistantMessage(multiplier = 1) {
  return {
    role: "assistant", provider: "openai-codex", api: "openai-codex-responses",
    model: "gpt-5.6-sol", content: [], stopReason: "stop", timestamp: 0,
    usage: {
      input: 1000000, output: 1000000, cacheRead: 1000000, cacheWrite: 1000000,
      totalTokens: 4000000,
      cost: { input: 2 * multiplier, output: 10 * multiplier,
        cacheRead: 0.2 * multiplier, cacheWrite: 2 * multiplier, total: 14.2 * multiplier },
    },
  };
}

for (const existingMultiplier of [1, 2, 2.5]) {
  test(`fast request records 2x cost without stacking on ${existingMultiplier}x provider pricing`, async () => {
    const { handlers, commands, ctx } = setup();
    await commands.get("fast").handler("on", ctx);
    handlers.get("before_provider_request")({ payload: { model: ctx.model.id } }, ctx);
    await commands.get("fast").handler("off", ctx);
    const message = assistantMessage(existingMultiplier);
    const result = handlers.get("message_end")?.({ message }, ctx);
    expect(result?.message.usage.cost).toEqual({ input: 4, output: 20, cacheRead: 0.4, cacheWrite: 4, total: 28.4 });
    expect(message.usage.cost.input).toBe(2 * existingMultiplier);
    expect(handlers.get("message_end")({ message: result.message }, ctx)).toBeUndefined();
  });
}

test("pricing uses request-time rates after a model switch", async () => {
  const { handlers, commands, ctx } = setup();
  await commands.get("fast").handler("on", ctx);
  handlers.get("before_provider_request")({ payload: { model: ctx.model.id } }, ctx);
  ctx.model.cost.input = 999;
  ctx.model.id = "different-model";
  const result = handlers.get("message_end")({ message: assistantMessage() }, ctx);
  expect(result.message.usage.cost.input).toBe(4);
});

test("unrelated messages and ended runs cannot consume stale fast pricing", async () => {
  const { handlers, commands, ctx } = setup();
  await commands.get("fast").handler("on", ctx);
  handlers.get("before_provider_request")({ payload: { model: ctx.model.id } }, ctx);
  expect(handlers.get("message_end")({
    message: { ...assistantMessage(), provider: "other-provider" },
  }, ctx)).toBeUndefined();
  handlers.get("agent_end")({}, ctx);
  expect(handlers.get("message_end")({ message: assistantMessage() }, ctx)).toBeUndefined();
});

test("enabling fast after a standard request does not change its pricing", async () => {
  const { handlers, commands, ctx } = setup();
  handlers.get("before_provider_request")({ payload: { model: ctx.model.id } }, ctx);
  await commands.get("fast").handler("on", ctx);
  expect(handlers.get("message_end")?.({ message: assistantMessage() }, ctx)).toBeUndefined();
});

test("the model ID alone does not enable fast mode on other providers", async () => {
  const { handlers, commands, notifications, ctx } = setup("other-provider");
  await commands.get("fast").handler("on", ctx);
  expect(notifications.at(-1).level).toBe("warning");
  expect(handlers.get("before_provider_request")({
    payload: { model: "gpt-5.6-sol" },
  }, ctx)).toBeUndefined();
});
