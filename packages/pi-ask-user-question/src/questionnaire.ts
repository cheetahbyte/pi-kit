import { Type, type Static } from "typebox";

const option = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 60 }),
  description: Type.String({ minLength: 1 }),
  preview: Type.Optional(Type.String({ description: "Markdown artifact to compare; single-select questions only." })),
});

export const parameters = Type.Object({
  questions: Type.Array(Type.Object({
    question: Type.String({ minLength: 1 }),
    header: Type.String({ minLength: 1, maxLength: 16 }),
    options: Type.Array(option, { minItems: 2, maxItems: 4 }),
    multiSelect: Type.Optional(Type.Boolean()),
  }), { minItems: 1, maxItems: 4 }),
  finalQuestion: Type.Optional(Type.String({
    minLength: 1,
    description: "Optional open-ended prompt for a separate Notes tab after all questions and before Submit. Ask for additional context, constraints, or notes. The user can leave it blank. Omit when unnecessary.",
  })),
});

export type QuestionnaireParams = Static<typeof parameters>;
export type Question = QuestionnaireParams["questions"][number];
export interface Answer {
  questionIndex: number;
  question: string;
  kind: "option" | "multi" | "custom";
  selected: string[];
  text?: string;
}
export interface QuestionnaireResult {
  cancelled: boolean;
  answers: Answer[];
  additionalContext?: { question: string; text: string };
}

export function validate(params: QuestionnaireParams): void {
  const questions = new Set<string>();
  for (const question of params.questions) {
    if (!question.question.trim() || !question.header.trim()) throw new Error("Questions and headers cannot be blank.");
    if (questions.has(question.question.trim())) throw new Error("Duplicate question.");
    questions.add(question.question.trim());
    const labels = new Set<string>();
    for (const option of question.options) {
      const label = option.label.trim().toLowerCase().replace(/[.!]+$/, "");
      if (!label || !option.description.trim()) throw new Error("Options need a label and description.");
      if (["other", "type something", "next"].includes(label)) throw new Error("Other, Type something., and Next are reserved labels.");
      if (labels.has(label)) throw new Error("Duplicate option label.");
      labels.add(label);
      if (question.multiSelect && option.preview !== undefined) throw new Error("Previews require a single-select question.");
    }
  }
  if (params.finalQuestion !== undefined && !params.finalQuestion.trim()) throw new Error("finalQuestion cannot be blank.");
}

export class Questionnaire {
  tab = 0;
  readonly answers: (Answer | undefined)[];
  readonly selections: Set<number>[];
  notes = "";

  constructor(readonly params: QuestionnaireParams) {
    this.answers = params.questions.map(() => undefined);
    this.selections = params.questions.map(() => new Set<number>());
  }

  get reviewTab(): number { return this.params.questions.length + (this.params.finalQuestion === undefined ? 0 : 1); }
  get isNotes(): boolean { return this.params.finalQuestion !== undefined && this.tab === this.params.questions.length; }
  get complete(): boolean { return this.answers.every(Boolean); }

  move(delta: number): void { this.tab = (this.tab + delta + this.reviewTab + 1) % (this.reviewTab + 1); }

  choose(index: number): void {
    const question = this.params.questions[this.tab];
    const selected = this.selections[this.tab];
    if (question.multiSelect) {
      if (selected.has(index)) selected.delete(index); else selected.add(index);
      this.answers[this.tab] = selected.size ? this.answer("multi", [...selected].sort((a, b) => a - b).map(i => question.options[i].label)) : undefined;
    } else {
      this.answers[this.tab] = this.answer("option", [question.options[index].label]);
      this.move(1);
    }
  }

  custom(text: string): boolean {
    if (!text.trim()) return false;
    this.selections[this.tab].clear();
    this.answers[this.tab] = this.answer("custom", [], text.trim());
    this.move(1);
    return true;
  }

  private answer(kind: Answer["kind"], selected: string[], text?: string): Answer {
    return { questionIndex: this.tab, question: this.params.questions[this.tab].question, kind, selected, ...(text ? { text } : {}) };
  }

  result(cancelled: boolean): QuestionnaireResult {
    if (cancelled) return { cancelled: true, answers: [] };
    return {
      cancelled: false,
      answers: this.answers.filter((answer): answer is Answer => answer !== undefined),
      ...(this.params.finalQuestion !== undefined && this.notes.trim()
        ? { additionalContext: { question: this.params.finalQuestion, text: this.notes.trim() } } : {}),
    };
  }
}
