import { expect, test } from "bun:test";
import { initTheme, Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, TuiMainScreen, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { QuestionDialog } from "./dialog.ts";
import { Questionnaire, type QuestionnaireResult } from "./questionnaire.ts";
import { fixture } from "./questionnaire.test.ts";

initTheme("dark", false);
const theme = new Theme(
  Object.fromEntries(["accent", "border", "muted", "dim", "warning", "text", "thinkingXhigh"].map(key => [key, "#eeeeee"])) as ConstructorParameters<typeof Theme>[0],
  { selectedBg: "#333333" } as ConstructorParameters<typeof Theme>[1],
  "truecolor",
);

function setup(finalQuestion?: string, multiSelect = false) {
  const terminal = {
    columns: 120, rows: 30, kittyProtocolActive: false,
    start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {},
    hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
    clearScreen() {}, setTitle() {}, setProgress() {},
  } satisfies Terminal;
  const params = fixture(finalQuestion);
  params.questions[0].multiSelect = multiSelect;
  const state = new Questionnaire(params);
  const results: QuestionnaireResult[] = [];
  const controller = new AbortController();
  const dialog = new QuestionDialog(state, new TuiMainScreen(terminal), theme, new KeybindingsManager(TUI_KEYBINDINGS), result => results.push(result), controller.signal);
  dialog.focused = true;
  return { dialog, state, results, controller, terminal };
}

const enter = "\r";
const down = "\u001b[B";

test("full keyboard flow includes editable notes, review, and explicit submit", () => {
  const { dialog, state, results } = setup("Anything else?");
  dialog.handleInput(enter);
  expect(state.isNotes).toBe(true);
  expect(dialog.render(100).join("\n")).toContain("Anything else?");
  expect(dialog.render(100).join("\n")).toContain(CURSOR_MARKER);
  dialog.handleInput("No network");
  dialog.handleInput("\u001b[13;2u");
  dialog.handleInput("Local only");
  dialog.handleInput(enter);
  expect(state.tab).toBe(state.reviewTab);
  expect(results).toHaveLength(0);
  dialog.handleInput(enter);
  expect(results[0].additionalContext?.text).toBe("No network\nLocal only");
  expect(results[0].answers[0].selected).toEqual(["Small"]);
});

test("blank final question can be skipped and its draft survives tab switches", () => {
  const { dialog, state, results } = setup("Any context?");
  dialog.handleInput(enter);
  dialog.handleInput("Keep this draft");
  dialog.handleInput("\t");
  dialog.handleInput("\u001b[Z");
  expect(state.notes).toBe("Keep this draft");
  dialog.handleInput("\u0015");
  dialog.handleInput(enter);
  dialog.handleInput(enter);
  expect(results[0]).not.toHaveProperty("additionalContext");
});

test("custom answer supports multiline editor and never submits the whole form", () => {
  const { dialog, state, results } = setup();
  dialog.handleInput(down); dialog.handleInput(down); dialog.handleInput(enter);
  dialog.handleInput("My own answer");
  dialog.handleInput(enter);
  expect(state.answers[0]?.text).toBe("My own answer");
  expect(state.tab).toBe(state.reviewTab);
  expect(results).toHaveLength(0);
});

test("multi-select Enter toggles, Next advances", () => {
  const { dialog, state } = setup(undefined, true);
  dialog.handleInput(enter); dialog.handleInput(down); dialog.handleInput(" ");
  expect(state.tab).toBe(0);
  dialog.handleInput(down); dialog.handleInput(down); dialog.handleInput(enter);
  expect(state.tab).toBe(state.reviewTab);
  expect(state.answers[0]?.selected).toEqual(["Small", "Broad"]);
});

test("review cannot submit unanswered questions", () => {
  const { dialog, state, results } = setup();
  dialog.handleInput("\t");
  dialog.handleInput(enter);
  expect(results).toHaveLength(0);
  expect(state.tab).toBe(0);
});

test("escape and abort cancel only once without publishing drafts", () => {
  const { dialog, results, controller } = setup("Notes?");
  dialog.handleInput(enter); dialog.handleInput("Draft");
  controller.abort(); dialog.handleInput("\u001b");
  expect(results).toEqual([{ cancelled: true, answers: [] }]);
});

test("preview renders beside options or stacks, including tiny and Unicode widths", () => {
  const { dialog, state } = setup();
  state.params.questions[0].options[0].preview = "```\n┌── UI ──┐\n│ 界 😀 │\n└────────┘\n```";
  for (const width of [1, 3, 10, 40, 100, 120]) {
    const lines = dialog.render(width);
    expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
  }
  expect(dialog.render(120).some(line => line.includes("Small") && line.includes("┌"))).toBe(true);
  dialog.dispose();
});

test("manual scrolling can reach the beginning after focusing a low row", () => {
  const { dialog, terminal } = setup(undefined, true);
  terminal.rows = 15;
  dialog.handleInput(down); dialog.handleInput(down); dialog.handleInput(down);
  dialog.render(60);
  dialog.handleInput("\u001b[5~");
  dialog.handleInput("\u001b[5~");
  expect(dialog.render(60).join("\n")).toContain("Which approach?");
  dialog.dispose();
});

test("focused choice stays visible in short terminals", () => {
  const { dialog, terminal } = setup(undefined, true);
  terminal.rows = 15;
  dialog.handleInput(down); dialog.handleInput(down); dialog.handleInput(down);
  const lines = dialog.render(60);
  expect(lines.join("\n")).toContain("Next");
  expect(lines.length).toBeLessThanOrEqual(terminal.rows);
  dialog.dispose();
});
