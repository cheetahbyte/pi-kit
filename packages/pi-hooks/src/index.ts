import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fromClaudeInput, interpret, loadConfig, matches, matchesIf, run, toClaudeInput, toClaudeTool, type Config, type HookEvent, type Outcome } from "./hooks.js";

const customType = "pi-hooks";
const defaultTimeout = 600;
const maxStopContinuations = 8;
const sessionEndReasons: Record<string, string> = { new: "clear", resume: "resume", fork: "resume" };

export default function (
  pi: ExtensionAPI,
  { userFile = join(getAgentDir(), "hooks.json"), projectFile = join(CONFIG_DIR_NAME, "hooks.json") } = {},
): void {
  let config: Config = {};
  let pendingContext: string[] = [];
  let stopContinuations = 0;
  const toolContext = new Map<string, string[]>();

  // An empty subject list means the event has no matcher support, so every group runs.
  const fire = async (
    event: HookEvent,
    ctx: ExtensionContext,
    subjects: string[],
    extra: Record<string, unknown>,
    { timeout = defaultTimeout, signal }: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<Outcome> => {
    const merged: Outcome = { context: [], notices: [] };
    const seen = new Set<string>();
    const toolInput = extra.tool_input as Record<string, unknown> | undefined;
    const handlers = (config[event] ?? [])
      .filter((group) => !subjects.length || subjects.some((subject) => matches(group?.matcher, subject)))
      .flatMap((group) => (Array.isArray(group.hooks) ? group.hooks : []))
      .filter((handler) => {
        const key = JSON.stringify([handler?.command, handler?.args]);
        if (handler?.type !== "command" || typeof handler.command !== "string" || seen.has(key)) return false;
        if (handler.if && !(toolInput && matchesIf(handler.if, String(extra.tool_name), toolInput, ctx.cwd))) return false;
        return seen.add(key);
      });
    if (!handlers.length) return merged;

    const input = JSON.stringify({
      session_id: ctx.sessionManager.getSessionId(),
      transcript_path: ctx.sessionManager.getSessionFile() ?? "",
      cwd: ctx.cwd,
      permission_mode: "default",
      hook_event_name: event,
      ...extra,
    });
    const outcomes = await Promise.all(handlers.map(async (handler) => interpret(event, await run(handler, ctx.cwd, input, handler.timeout ?? timeout, signal))));
    for (const outcome of outcomes) {
      merged.context.push(...outcome.context);
      merged.notices.push(...outcome.notices);
      merged.block ??= outcome.block;
      merged.ask ??= outcome.ask;
      merged.stop ??= outcome.stop;
      merged.updatedInput = outcome.updatedInput ?? merged.updatedInput;
    }
    for (const notice of merged.notices) ctx.ui.notify(notice, "warning");
    return merged;
  };

  const startSession = async (source: string, ctx: ExtensionContext): Promise<void> => {
    pendingContext.push(...(await fire("SessionStart", ctx, [source], { source, model: ctx.model?.id })).context);
  };

  const toolEvent = (event: { toolName: string; toolCallId: string; input: unknown }, cwd: string) => {
    const toolName = toClaudeTool(event.toolName);
    const extra = { tool_name: toolName, tool_input: toClaudeInput(event.toolName, event.input as Record<string, unknown>, cwd), tool_use_id: event.toolCallId };
    return { subjects: [toolName, event.toolName], extra };
  };

  pi.on("session_start", async (event, ctx) => {
    config = loadConfig([userFile, ...(ctx.isProjectTrusted() ? [join(ctx.cwd, projectFile)] : [])]);
    pendingContext = [];
    if (event.reason !== "reload") await startSession(event.reason === "new" ? "clear" : event.reason, ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    stopContinuations = 0;
    const outcome = await fire("UserPromptSubmit", ctx, [], { prompt: event.text }, { timeout: 30 });
    const blocked = outcome.block ?? outcome.stop;
    if (blocked) {
      ctx.ui.notify(`Prompt blocked by hook: ${blocked}`, "warning");
      return { action: "handled" };
    }
    if (!outcome.context.length) return;
    if (ctx.isIdle()) pendingContext.push(...outcome.context);
    else pi.sendMessage({ customType, content: outcome.context.join("\n\n"), display: false }, { deliverAs: event.streamingBehavior ?? "steer" });
  });

  pi.on("before_agent_start", () => {
    if (!pendingContext.length) return;
    const content = pendingContext.join("\n\n");
    pendingContext = [];
    return { message: { customType, content, display: false } };
  });

  pi.on("tool_call", async (event, ctx) => {
    const { subjects, extra } = toolEvent(event, ctx.cwd);
    const outcome = await fire("PreToolUse", ctx, subjects, extra, { signal: ctx.signal });
    if (outcome.stop) return { block: true, reason: outcome.stop, terminate: true };
    if (outcome.block) return { block: true, reason: outcome.block };
    if (outcome.ask && !(ctx.hasUI && (await ctx.ui.confirm(`Allow ${event.toolName}?`, outcome.ask)))) return { block: true, reason: `Not approved: ${outcome.ask}` };
    if (outcome.updatedInput) {
      const input = event.input as Record<string, unknown>;
      for (const key of Object.keys(input)) delete input[key];
      Object.assign(input, fromClaudeInput(event.toolName, outcome.updatedInput));
    }
    if (outcome.context.length) toolContext.set(event.toolCallId, outcome.context);
  });

  pi.on("tool_result", async (event, ctx) => {
    const { subjects, extra } = toolEvent(event, ctx.cwd);
    const text = event.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
    const result = event.isError ? { error: text } : { tool_response: { content: event.content, details: event.details } };
    const outcome = await fire(event.isError ? "PostToolUseFailure" : "PostToolUse", ctx, subjects, { ...extra, ...result }, { signal: ctx.signal });
    const feedback = [...(toolContext.get(event.toolCallId) ?? []), ...outcome.context, ...(outcome.block ? [outcome.block] : [])];
    toolContext.delete(event.toolCallId);
    if (outcome.stop) ctx.abort();
    if (!feedback.length) return;
    const reminder = { type: "text" as const, text: `<system-reminder>\n${feedback.join("\n\n")}\n</system-reminder>` };
    return { content: [...event.content, reminder], structuredContent: event.structuredContent };
  });

  pi.on("agent_end", async (event, ctx) => {
    const last = event.messages.findLast((message) => message.role === "assistant");
    if (last?.stopReason === "aborted") return;
    const lastText = last?.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? "";
    const outcome = await fire("Stop", ctx, [], { stop_hook_active: stopContinuations > 0, last_assistant_message: lastText });
    const feedback = [...(outcome.block ? [outcome.block] : []), ...outcome.context];
    if (outcome.stop || !feedback.length || stopContinuations >= maxStopContinuations) return;
    stopContinuations++;
    pi.sendMessage({ customType, content: feedback.join("\n\n"), display: true }, { triggerTurn: true });
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const trigger = event.reason === "manual" ? "manual" : "auto";
    const outcome = await fire("PreCompact", ctx, [trigger], { trigger, custom_instructions: event.customInstructions ?? null }, { signal: event.signal });
    if (!outcome.block) return;
    ctx.ui.notify(`Compaction blocked by hook: ${outcome.block}`, "warning");
    return { cancel: true };
  });

  pi.on("session_compact", async (event, ctx) => {
    const trigger = event.reason === "manual" ? "manual" : "auto";
    await fire("PostCompact", ctx, [trigger], { trigger, compact_summary: event.compactionEntry.summary });
    await startSession("compact", ctx);
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason === "reload") return;
    const reason = sessionEndReasons[event.reason] ?? "other";
    await fire("SessionEnd", ctx, [reason], { reason }, { timeout: 1.5 });
  });
}
