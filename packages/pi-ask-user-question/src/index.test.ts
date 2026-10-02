import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension, { askUserQuestion } from "./index.js";
import type { QuestionnaireResult } from "./questionnaire.js";
import { fixture } from "./questionnaire.test.js";

test("extension registers the questionnaire tool", () => {
  const names: string[] = [];
  const api = { registerTool(tool: { name: string }) { names.push(tool.name); } } as ExtensionAPI;
  extension(api);
  expect(names).toEqual(["ask_user_question"]);
});

test("execute returns notes in model-facing text as well as details", async () => {
  const expected: QuestionnaireResult = {
    cancelled: false,
    answers: [{ questionIndex: 0, question: "Which approach?", kind: "option", selected: ["Small"] }],
    additionalContext: { question: "Anything else?", text: "Offline only" },
  };
  const ctx = { mode: "tui", ui: { custom: async () => expected } } as unknown as ExtensionContext;
  const result = await askUserQuestion.execute("test", fixture("Anything else?"), undefined, undefined, ctx);
  expect(result.details).toEqual(expected);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(expected) }]);
});

test("aborted calls never open a dialog", async () => {
  const ctx = { mode: "tui", ui: { custom: () => { throw new Error("Unexpected UI"); } } } as unknown as ExtensionContext;
  const result = await askUserQuestion.execute("test", fixture(), AbortSignal.abort(), undefined, ctx);
  expect(result.details).toEqual({ cancelled: true, answers: [] });
});

test("non-terminal calls fail with actionable guidance", async () => {
  for (const mode of ["rpc", "print"]) {
    const ctx = { mode } as ExtensionContext;
    await expect(askUserQuestion.execute("test", fixture(), undefined, undefined, ctx)).rejects.toThrow("Ask the user in chat instead");
  }
});
