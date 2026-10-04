import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, getMarkdownTheme, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const entryType = "pi-btw";
const systemPrompt = `You are answering a side question while the user's main coding session continues.

The conversation so far is background. Do not continue its work and do not call tools: you have none. Answer the side question directly and briefly, in plain text or Markdown. Name files, functions, and line numbers when the conversation supports them. If the conversation doesn't contain the answer, say so instead of guessing.`;

export type Turn = { question: string; answer: string };

// A side question can arrive mid-turn. Providers reject tool calls without results, so the context stops before the first one.
export function settledMessages(messages: Message[]): Message[] {
  const answered = new Set(messages.flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])));
  const dangling = messages.findIndex((message) => message.role === "assistant" && message.content.some((part) => part.type === "toolCall" && !answered.has(part.id)));
  return dangling === -1 ? messages : messages.slice(0, dangling);
}

export function threadTurns(branch: SessionEntry[]): Turn[] {
  let turns: Turn[] = [];
  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== entryType) continue;
    const data = entry.data as Partial<Turn> & { reset?: boolean };
    if (data.reset) turns = [];
    else if (data.question && data.answer) turns.push({ question: data.question, answer: data.answer });
  }
  return turns;
}

export function buildPrompt(turns: Turn[], question: string): string {
  if (!turns.length) return question;
  const thread = turns.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`).join("\n\n");
  return `Earlier side questions and your answers:\n\n${thread}\n\nSide question: ${question}`;
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("btw", {
    description: "Ask a side question without adding it to the main conversation",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (!question) return ctx.ui.notify("Usage: /btw <question>, or /btw clear to forget earlier side questions", "warning");
      if (question === "clear") {
        pi.appendEntry(entryType, { reset: true });
        return ctx.ui.notify("Forgot earlier side questions", "info");
      }
      const { model, sessionManager } = ctx;
      if (ctx.mode !== "tui") return ctx.ui.notify("/btw requires interactive mode", "error");
      if (!model) return ctx.ui.notify("/btw requires an active model", "error");

      const context = buildSessionContext(sessionManager.getEntries(), sessionManager.getLeafId()).messages;
      const prompt: UserMessage = {
        role: "user",
        content: [{ type: "text", text: buildPrompt(threadTurns(sessionManager.getBranch()), question) }],
        timestamp: Date.now(),
      };
      const messages = [...settledMessages(convertToLlm(context)), prompt];

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          const controller = new AbortController();
          let answer: Markdown | undefined;
          let error = "";
          let scroll = 0;

          ctx.modelRegistry
            .complete(model, { systemPrompt, messages }, { signal: controller.signal })
            .then((response) => {
              const text = response.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
              if (response.stopReason === "error" || !text) error = response.errorMessage ?? "The model returned no text.";
              else if (response.stopReason !== "aborted") {
                answer = new Markdown(text, 1, 0, getMarkdownTheme());
                pi.appendEntry(entryType, { question, answer: text });
              }
            })
            .catch((reason: unknown) => {
              error = reason instanceof Error ? reason.message : String(reason);
            })
            .finally(() => tui.requestRender());

          return {
            render(width: number): string[] {
              const view = Math.max(5, tui.terminal.rows - 12);
              const body = answer ? answer.render(width) : [error ? theme.fg("error", ` ${error}`) : theme.fg("dim", ` Asking ${model.id}…`)];
              scroll = Math.min(Math.max(0, scroll), Math.max(0, body.length - view));
              const rule = theme.fg("accent", "─".repeat(width));
              const hints = body.length > view ? `↑/↓ scroll (${scroll + 1}-${Math.min(body.length, scroll + view)} of ${body.length}) · Esc close` : "Esc close";
              return [
                rule,
                truncateToWidth(` ${theme.fg("accent", theme.bold("/btw"))} ${question.replace(/\s+/g, " ")}`, width),
                "",
                ...body.slice(scroll, scroll + view).map((line) => truncateToWidth(line, width)),
                "",
                theme.fg("dim", ` ${hints}`),
                rule,
              ];
            },
            invalidate() {
              answer?.invalidate();
            },
            handleInput(data: string): void {
              if (matchesKey(data, Key.escape)) {
                controller.abort();
                return done();
              }
              if (matchesKey(data, Key.up)) scroll--;
              else if (matchesKey(data, Key.down)) scroll++;
              tui.requestRender();
            },
          };
        },
        { overlay: true },
      );
    },
  });
}
