import { calculateCost } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const stateType = "pi-codex-fast";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompatible(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === "openai-codex"
    && ctx.model.api === "openai-codex-responses";
}

export default function (pi: ExtensionAPI): void {
  let enabled = false;
  let requestModel: ExtensionContext["model"];

  const status = (ctx: ExtensionContext): string =>
    !enabled ? "Fast mode off"
      : isCompatible(ctx) ? "Fast mode on (priority requested)"
        : "Fast mode on (inactive: incompatible model)";

  const updateStatus = (ctx: ExtensionContext): void => {
    const value = enabled ? isCompatible(ctx) ? "Fast: on" : "Fast: inactive" : null;
    pi.events.emit("pi-footer:update-widget", { widgetId: "codex-fast", value });
    if (ctx.hasUI) {
      ctx.ui.setStatus(stateType, value ?? undefined);
    }
  };

  const restore = (ctx: ExtensionContext): void => {
    requestModel = undefined;
    enabled = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === stateType
        && isRecord(entry.data) && typeof entry.data.enabled === "boolean") {
        enabled = entry.data.enabled;
      }
    }
    updateStatus(ctx);
  };

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    pi.events.emit("pi-footer:update-widget", { widgetId: "codex-fast", value: null });
    if (ctx.hasUI) ctx.ui.setStatus(stateType, undefined);
  });

  pi.on("before_provider_request", (event, ctx) => {
    requestModel = undefined;
    if (!enabled || !isCompatible(ctx) || !isRecord(event.payload)) return;
    if (event.payload.model !== ctx.model?.id) return;
    requestModel = structuredClone(ctx.model);
    return { ...event.payload, service_tier: "priority" };
  });

  pi.on("message_end", ({ message }) => {
    const model = requestModel;
    if (!model || message.role !== "assistant"
      || message.provider !== model.provider || message.api !== model.api
      || message.model !== model.id) return;
    requestModel = undefined;
    const usage = { ...message.usage, cost: { ...message.usage.cost } };
    calculateCost(model, usage);
    usage.cost.input *= 2;
    usage.cost.output *= 2;
    usage.cost.cacheRead *= 2;
    usage.cost.cacheWrite *= 2;
    usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
    return { message: { ...message, usage } };
  });

  pi.on("agent_end", () => {
    requestModel = undefined;
  });

  pi.registerCommand("fast", {
    description: "Toggle Codex fast mode (higher usage); /fast on|off|status",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "status") {
        ctx.ui.notify(status(ctx), "info");
        return;
      }
      if (action !== "" && action !== "on" && action !== "off") {
        ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
        return;
      }
      const next = action === "" ? !enabled : action === "on";
      if (next && !isCompatible(ctx)) {
        ctx.ui.notify("Fast mode requires a supported openai-codex model. See pi-codex-fast/README.md.", "warning");
        return;
      }
      enabled = next;
      pi.appendEntry(stateType, { enabled });
      updateStatus(ctx);
      ctx.ui.notify(enabled
        ? "Fast mode on for subsequent requests. Higher usage rates apply; account eligibility is required."
        : "Fast mode off. Provider defaults apply to subsequent requests.", "info");
    },
  });
}
