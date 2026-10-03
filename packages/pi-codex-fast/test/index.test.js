import { expect, test } from "bun:test";
import extension from "../src/index.ts";

function setup(provider = "openai-codex") {
  const handlers = new Map();
  const commands = new Map();
  const widgets = [];
  const notifications = [];
  const ctx = {
    model: { provider, api: "openai-codex-responses", id: "gpt-5.6-sol" },
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

test("the model ID alone does not enable fast mode on other providers", async () => {
  const { handlers, commands, notifications, ctx } = setup("other-provider");
  await commands.get("fast").handler("on", ctx);
  expect(notifications.at(-1).level).toBe("warning");
  expect(handlers.get("before_provider_request")({
    payload: { model: "gpt-5.6-sol" },
  }, ctx)).toBeUndefined();
});
