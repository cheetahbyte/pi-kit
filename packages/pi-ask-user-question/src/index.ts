import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { QuestionDialog } from "./dialog.ts";
import { parameters, Questionnaire, validate, type QuestionnaireResult } from "./questionnaire.ts";

export const askUserQuestion = defineTool<typeof parameters, QuestionnaireResult>({
  name: "ask_user_question",
  label: "Ask user question",
  description: "Ask 1–4 structured questions in a tabbed questionnaire. Each question needs 2–4 options with descriptions. A custom-answer row is appended automatically: do not author Other, Type something., or Next. Use multiSelect for multiple choices. Single-select options can include Markdown previews. Put recommended choices first and label them (Recommended). Optionally supply finalQuestion to ask for additional context or notes in a separate, skippable Notes tab before the final review. Omit finalQuestion when no extra context is needed. Esc cancels without submitting answers.",
  executionMode: "sequential",
  parameters,
  async execute(_id, params, signal, _onUpdate, ctx) {
    validate(params);
    if (ctx.mode !== "tui") throw new Error("ask_user_question requires an interactive terminal. Ask the user in chat instead.");
    const state = new Questionnaire(params);
    if (signal?.aborted) return response(state.result(true));
    const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, keys, done) => {
      const dialog = new QuestionDialog(state, tui, theme, keys, done, signal);
      if (signal?.aborted) queueMicrotask(() => dialog.cancel());
      return dialog;
    });
    return response(result);
  },
  renderCall(args, theme) {
    return new Text(theme.fg("toolTitle", theme.bold("Ask user question")) + theme.fg("muted", ` · ${args.questions?.length ?? 0} questions${args.finalQuestion ? " + notes" : ""}`), 0, 0);
  },
  renderResult(result, _options, theme) {
    if (!result.details) return new Text(result.content.filter(item => item.type === "text").map(item => item.text).join("\n"), 0, 0);
    if (result.details.cancelled) return new Text(theme.fg("muted", "Questionnaire cancelled."), 0, 0);
    const lines = result.details.answers.map(answer => `${answer.question}\n  ${answer.text ?? answer.selected.join(", ")}`);
    if (result.details.additionalContext) lines.push(`${result.details.additionalContext.question}\n  ${result.details.additionalContext.text}`);
    return new Text(lines.join("\n"), 0, 0);
  },
});

function response(result: QuestionnaireResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool(askUserQuestion);
}
