import type { ExtensionAPI, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const defaultReserveTokens = 16384;
const imageTokens = 1200;

export const formatTokens = (tokens: number): string =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : `${tokens}`;

export function estimate(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, part) => sum + estimate(part), 0);
  if (value && typeof value === "object" && "type" in value && value.type === "image") return imageTokens;
  return Math.ceil((typeof value === "string" ? value : (JSON.stringify(value) ?? "")).length / 4);
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("context", {
    description: "Show context window usage",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      if (!usage?.tokens) {
        ctx.ui.notify("Context usage is not available yet. Send a message first.", "info");
        return;
      }

      const activeTools = new Set(pi.getActiveTools());
      const toolDefinitions = pi.getAllTools().filter(({ name }) => activeTools.has(name)).map(({ name, description, parameters }) => ({ name, description, parameters }));
      const raw = { system: estimate(ctx.getSystemPrompt()), tools: estimate(toolDefinitions), messages: 0, toolCalls: 0 };
      for (const entry of ctx.sessionManager.buildContextEntries()) {
        if (entry.type === "compaction" || entry.type === "branch_summary") raw.messages += estimate(entry.summary);
        if (entry.type !== "message") continue;
        const { message } = entry;
        if (message.role === "assistant") {
          for (const part of message.content) {
            if (part.type === "toolCall") raw.toolCalls += estimate(part);
            else raw.messages += estimate(part.type === "text" ? part.text : part.thinking);
          }
        } else if (message.role === "toolResult") raw.toolCalls += estimate(message.content);
        else if (message.role === "bashExecution") raw.toolCalls += estimate([message.command, message.output]);
        else if (message.role === "user" || message.role === "custom") raw.messages += estimate(message.content);
      }

      let input = 0;
      let cacheRead = 0;
      let output = 0;
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message" || entry.message.role !== "assistant") continue;
        input += entry.message.usage.input;
        cacheRead += entry.message.usage.cacheRead;
        output += entry.message.usage.output;
      }

      // Estimates are scaled so the categories add up to the token count the provider reported.
      const scale = usage.tokens / (raw.system + raw.tools + raw.messages + raw.toolCalls);
      const reserve = pi.getSettings().compaction?.reserveTokens ?? defaultReserveTokens;
      const rows: Array<{ label: string; color: ThemeColor; tokens: number }> = [
        { label: "System prompt", color: "muted", tokens: Math.round(raw.system * scale) },
        { label: "Tool definitions", color: "success", tokens: Math.round(raw.tools * scale) },
        { label: "Messages", color: "accent", tokens: Math.round(raw.messages * scale) },
        { label: "Tool calls", color: "warning", tokens: Math.round(raw.toolCalls * scale) },
        { label: "Free", color: "dim", tokens: Math.max(0, usage.contextWindow - reserve - usage.tokens) },
        { label: "Compaction reserve", color: "error", tokens: reserve },
      ];
      const percent = (tokens: number): string => `${((tokens / usage.contextWindow) * 100).toFixed(1)}%`;

      const render = (width: number, paint: (color: ThemeColor, text: string) => string): string[] => {
        const barWidth = Math.max(10, Math.min(60, width - 2));
        const bar = rows.map(({ color, tokens, label }) => {
          const cells = Math.round((tokens / usage.contextWindow) * barWidth);
          return paint(color, (label === "Free" ? "░" : "█").repeat(tokens > 0 ? Math.max(1, cells) : 0));
        });
        const totalInput = input + cacheRead;
        return [
          `${ctx.model?.id ?? "Context"} · ${formatTokens(usage.tokens!)} of ${formatTokens(usage.contextWindow)} (${percent(usage.tokens!)})`,
          bar.join(""),
          "",
          ...rows.map(({ label, color, tokens }) => `${paint(color, "■")} ${label.padEnd(20)}${formatTokens(tokens).padStart(6)}${percent(tokens).padStart(8)}`),
          "",
          paint("dim", `Session: ${formatTokens(totalInput)} input (${totalInput ? Math.round((cacheRead / totalInput) * 100) : 0}% cached) · ${formatTokens(output)} output`),
        ].map((line) => truncateToWidth(` ${line}`, width));
      };

      if (ctx.mode !== "tui") {
        ctx.ui.notify(render(80, (_color, text) => text).join("\n"), "info");
        return;
      }
      await ctx.ui.custom<void>(
        (_tui, theme, _keybindings, done) => ({
          render(width: number): string[] {
            const rule = theme.fg("accent", "─".repeat(width));
            return [rule, ...render(width, (color, text) => theme.fg(color, text)), theme.fg("dim", " Press any key to close"), rule];
          },
          invalidate() {},
          handleInput: () => done(),
        }),
        { overlay: true },
      );
    },
  });
}
