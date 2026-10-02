import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import { parameters, Questionnaire, validate, type QuestionnaireParams } from "./questionnaire.js";

export function fixture(finalQuestion?: string): QuestionnaireParams {
  return {
    questions: [{ question: "Which approach?", header: "Approach", options: [
      { label: "Small", description: "Keep the change small." },
      { label: "Broad", description: "Cover more cases." },
    ] }],
    ...(finalQuestion === undefined ? {} : { finalQuestion }),
  };
}

describe("questionnaire", () => {
  test("without a final prompt, answers advance straight to review", () => {
    const state = new Questionnaire(fixture());
    state.choose(0);
    expect(state.tab).toBe(state.reviewTab);
    expect(state.isNotes).toBe(false);
    expect(state.result(false)).not.toHaveProperty("additionalContext");
  });
  test("final prompt creates a separate skippable notes tab before review", () => {
    const state = new Questionnaire(fixture("Anything else?"));
    state.choose(1);
    expect(state.isNotes).toBe(true);
    expect(state.complete).toBe(true);
    expect(state.reviewTab).toBe(2);
    state.move(1);
    expect(state.tab).toBe(state.reviewTab);
    expect(state.result(false)).not.toHaveProperty("additionalContext");
  });
  test("notes survive navigation and reach the result with their prompt", () => {
    const state = new Questionnaire(fixture("Any constraints?"));
    state.choose(0);
    state.notes = "Offline only\nKeep it simple.";
    state.move(-1);
    state.choose(1);
    expect(state.notes).toBe("Offline only\nKeep it simple.");
    expect(state.result(false).additionalContext).toEqual({ question: "Any constraints?", text: state.notes });
  });
  test("notes never answer a structured question and cancellation discards drafts", () => {
    const state = new Questionnaire(fixture("Anything else?"));
    state.notes = "Something";
    expect(state.complete).toBe(false);
    expect(state.result(true)).toEqual({ cancelled: true, answers: [] });
  });
  test("multi-select toggles choices without advancing, custom answer replaces them", () => {
    const params = fixture();
    params.questions[0].multiSelect = true;
    const state = new Questionnaire(params);
    state.choose(1);
    state.choose(0);
    expect(state.answers[0]?.selected).toEqual(["Small", "Broad"]);
    expect(state.tab).toBe(0);
    state.choose(1);
    state.choose(0);
    expect(state.complete).toBe(false);
    expect(state.custom("  ")).toBe(false);
    expect(state.custom("My approach")).toBe(true);
    expect(state.answers[0]?.kind).toBe("custom");
    expect(state.selections[0].size).toBe(0);
  });
});

describe("validation", () => {
  test("schema enforces question, option, header, and label limits", () => {
    expect(Value.Check(parameters, fixture())).toBe(true);
    expect(Value.Check(parameters, { questions: [] })).toBe(false);
    for (const edit of [
      (p: QuestionnaireParams) => { p.questions = Array.from({ length: 5 }, () => p.questions[0]); },
      (p: QuestionnaireParams) => { p.questions[0].header = "x".repeat(17); },
      (p: QuestionnaireParams) => { p.questions[0].options[0].label = "x".repeat(61); },
      (p: QuestionnaireParams) => { p.questions[0].options.pop(); },
    ]) {
      const params = fixture(); edit(params);
      expect(Value.Check(parameters, params)).toBe(false);
    }
  });
  test("rejects reserved labels, duplicate labels, blank prompt, and multi previews", () => {
    for (const label of ["Other", "Type something.", "Next", " SMALL "]) {
      const params = fixture(); params.questions[0].options[1].label = label;
      expect(() => validate(params)).toThrow();
    }
    expect(() => validate(fixture("   "))).toThrow();
    const params = fixture();
    params.questions[0].multiSelect = true;
    params.questions[0].options[0].preview = "code";
    expect(() => validate(params)).toThrow();
  });
});
