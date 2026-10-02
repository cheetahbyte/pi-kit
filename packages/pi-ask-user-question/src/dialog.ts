import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Editor, Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { Questionnaire, type QuestionnaireResult } from "./questionnaire.js";

export class QuestionDialog implements Component, Focusable {
  private hasFocus = false;
  private readonly editors: Editor[];
  private readonly rows: number[];
  private editing = false;
  private reviewRow = 0;
  private scroll = 0;
  private followFocus = true;
  private finished = false;
  private readonly abort = () => this.finish(true);

  constructor(
    readonly state: Questionnaire,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keys: Pick<KeybindingsManager, "matches">,
    private readonly done: (result: QuestionnaireResult) => void,
    private readonly signal?: AbortSignal,
  ) {
    this.rows = state.params.questions.map(() => 0);
    this.editors = Array.from({ length: state.params.questions.length + 1 }, (_, i) => {
      const editor = new Editor(tui, {
        borderColor: text => theme.fg("border", text),
        selectList: {
          selectedPrefix: text => theme.fg("accent", text),
          selectedText: text => theme.fg("accent", text),
          description: text => theme.fg("muted", text),
          scrollInfo: text => theme.fg("dim", text),
          noMatch: text => theme.fg("warning", text),
        },
      });
      editor.onChange = () => {
        if (i === state.params.questions.length) state.notes = editor.getExpandedText();
        tui.requestRender();
      };
      editor.onSubmit = text => {
        editor.setText(text);
        if (state.isNotes) this.changeTab(1);
        else if (state.custom(text)) this.afterTabChange();
        tui.requestRender();
      };
      return editor;
    });
    signal?.addEventListener("abort", this.abort, { once: true });
  }

  get focused(): boolean { return this.hasFocus; }
  set focused(value: boolean) { this.hasFocus = value; this.syncFocus(); }

  private syncFocus(): void {
    for (const [index, editor] of this.editors.entries()) {
      editor.focused = this.hasFocus && index === this.state.tab && (this.editing || this.state.isNotes);
    }
  }

  cancel(): void { this.finish(true); }

  dispose(): void { this.signal?.removeEventListener("abort", this.abort); }
  invalidate(): void { for (const editor of this.editors) editor.invalidate(); }

  private finish(cancelled: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    this.done(this.state.result(cancelled));
  }

  private afterTabChange(): void {
    this.editing = false;
    this.scroll = 0;
    this.followFocus = true;
    this.syncFocus();
  }

  private changeTab(delta: number): void { this.state.move(delta); this.afterTabChange(); }

  handleInput(data: string): void {
    if (this.finished) return;
    this.input(data);
    this.syncFocus();
    this.tui.requestRender();
  }

  private input(data: string): void {
    if (this.keys.matches(data, "tui.select.cancel")) { this.finish(true); return; }
    if (matchesKey(data, "tab")) { this.changeTab(1); return; }
    if (matchesKey(data, "shift+tab")) { this.changeTab(-1); return; }
    if (matchesKey(data, "pageDown")) { this.followFocus = false; this.scroll += 5; return; }
    if (matchesKey(data, "pageUp")) { this.followFocus = false; this.scroll = Math.max(0, this.scroll - 5); return; }
    this.followFocus = true;
    if (this.editing || this.state.isNotes) {
      this.editors[this.state.tab].handleInput(data);
      return;
    }
    if (matchesKey(data, "right")) { this.changeTab(1); return; }
    if (matchesKey(data, "left")) { this.changeTab(-1); return; }
    const up = this.keys.matches(data, "tui.select.up");
    const down = this.keys.matches(data, "tui.select.down");
    const confirm = this.keys.matches(data, "tui.select.confirm");
    if (this.state.tab === this.state.reviewTab) {
      if (up || down) this.reviewRow = 1 - this.reviewRow;
      if (confirm) {
        if (this.reviewRow === 1) this.finish(true);
        else if (this.state.complete) this.finish(false);
        else { this.state.tab = this.state.answers.findIndex(answer => !answer); this.afterTabChange(); }
      }
      return;
    }
    const question = this.state.params.questions[this.state.tab];
    const count = question.options.length + 1 + (question.multiSelect ? 1 : 0);
    if (up || down) {
      this.rows[this.state.tab] = (this.rows[this.state.tab] + (up ? -1 : 1) + count) % count;
      this.scroll = 0;
    }
    const row = this.rows[this.state.tab];
    if (confirm || (data === " " && question.multiSelect && row < question.options.length)) {
      if (row < question.options.length) {
        this.state.choose(row);
        if (!question.multiSelect) this.afterTabChange();
      } else if (row === question.options.length) {
        this.editing = true;
      } else if (this.state.answers[this.state.tab]) this.changeTab(1);
    }
  }

  render(width: number): string[] {
    width = Math.max(1, width);
    const inner = Math.max(1, width - 4);
    const theme = this.theme;
    const labels = this.state.params.questions.map((question, index) => `${this.state.answers[index] ? "■" : "□"} ${question.header}`);
    if (this.state.params.finalQuestion !== undefined) labels.push(`${this.state.notes.trim() ? "■" : "□"} Notes`);
    labels.push("✓ Submit");
    let tabs = labels.map((label, i) => i === this.state.tab ? theme.bg("selectedBg", ` ${label} `) : theme.fg("muted", ` ${label} `)).join(" ");
    if (visibleWidth(tabs) > inner) tabs = `← ${this.state.tab + 1}/${labels.length} ${labels[this.state.tab]} →`;
    const body: string[] = [];
    let target = 0;
    const wrap = (text: string) => wrapTextWithAnsi(text, inner);
    if (this.state.isNotes) {
      body.push(...wrap(theme.bold(this.state.params.finalQuestion!)), "", theme.fg("muted", "Optional — leave blank to skip."), "");
      const editorLines = this.editors[this.state.tab].render(inner);
      target = body.length + Math.max(0, editorLines.findIndex(line => line.includes(CURSOR_MARKER)));
      body.push(...editorLines);
    } else if (this.state.tab === this.state.reviewTab) {
      body.push(theme.bold("Review your answers"), "");
      for (const [index, question] of this.state.params.questions.entries()) {
        const answer = this.state.answers[index];
        body.push(...wrap(`${question.header}: ${answer ? answer.text ?? answer.selected.join(", ") : theme.fg("warning", "Unanswered")}`));
      }
      if (this.state.params.finalQuestion !== undefined) {
        body.push("", ...wrap(this.state.params.finalQuestion), ...wrap(this.state.notes.trim() || theme.fg("dim", "No additional notes.")));
      }
      body.push("");
      target = body.length + this.reviewRow;
      body.push(this.row("Submit answers", this.reviewRow === 0), this.row("Cancel", this.reviewRow === 1));
      if (!this.state.complete) body.push("", ...wrap(theme.fg("warning", "Answer all questions before submitting. Notes are optional.")));
    } else {
      const question = this.state.params.questions[this.state.tab];
      const selected = this.rows[this.state.tab];
      body.push(...wrap(theme.bold(question.question)), "");
      const preview = !question.multiSelect && !this.editing ? question.options[selected]?.preview : undefined;
      const split = preview !== undefined && inner >= 96;
      const listWidth = split ? Math.floor(inner * 0.42) : inner;
      const list: string[] = [];
      for (const [i, option] of question.options.entries()) {
        if (i === selected) target = body.length + list.length;
        const checked = question.multiSelect ? (this.state.selections[this.state.tab].has(i) ? "[✓] " : "[ ] ") : "";
        list.push(...wrapTextWithAnsi(this.row(`${i + 1}. ${checked}${option.label}`, i === selected), listWidth));
        list.push(...wrapTextWithAnsi(theme.fg("muted", `    ${option.description}`), listWidth), "");
      }
      if (selected === question.options.length) target = body.length + list.length;
      list.push(this.row(`${question.options.length + 1}. Type something.`, selected === question.options.length));
      if (this.editing) {
        const editorLines = this.editors[this.state.tab].render(listWidth);
        target = body.length + list.length + Math.max(0, editorLines.findIndex(line => line.includes(CURSOR_MARKER)));
        list.push(...editorLines);
      } else if (this.editors[this.state.tab].getText()) {
        list.push(...wrapTextWithAnsi(theme.fg("dim", this.editors[this.state.tab].getExpandedText()), listWidth));
      }
      if (question.multiSelect) {
        if (selected > question.options.length) target = body.length + list.length + 1;
        list.push("", this.row("Next", selected > question.options.length));
      }
      if (preview !== undefined) {
        const previewWidth = Math.max(4, split ? inner - listWidth - 3 : inner);
        const contentWidth = Math.max(1, previewWidth - 4);
        const content = new Markdown(preview, 0, 0, getMarkdownTheme()).render(contentWidth);
        const box = ["┌" + "─".repeat(previewWidth - 2) + "┐", ...content.map(line => "│ " + line + " ".repeat(Math.max(0, contentWidth - visibleWidth(line))) + " │"), "└" + "─".repeat(previewWidth - 2) + "┘"];
        if (split) {
          for (let i = 0; i < Math.max(list.length, box.length); i++) {
            const left = truncateToWidth(list[i] ?? "", listWidth);
            body.push(left + " ".repeat(Math.max(0, listWidth - visibleWidth(left)) + 3) + (box[i] ?? ""));
          }
        } else body.push(...list, "", ...box);
      } else body.push(...list);
    }
    const height = Math.max(1, this.tui.terminal.rows - 9);
    const maxScroll = Math.max(0, body.length - height);
    if (this.followFocus) {
      if (target < this.scroll) this.scroll = target;
      else if (target >= this.scroll + height) this.scroll = target - height + 1;
    }
    this.scroll = Math.min(this.scroll, maxScroll);
    const visible = body.slice(this.scroll, this.scroll + height);
    const hint = this.editing || this.state.isNotes
      ? "Enter next · Shift+Enter newline · Tab/Shift+Tab tabs · Esc cancel"
      : "↑↓ move · Enter choose · Tab/Shift+Tab tabs · Esc cancel";
    return [
      theme.fg("border", "─".repeat(width)),
      `  ${tabs}`, "",
      ...visible.map(line => `  ${line}`), "",
      `  ${theme.fg("dim", `${this.scroll > 0 ? "↑ " : ""}${this.scroll < maxScroll ? "↓ " : ""}${hint} · PgUp/PgDn scroll`)}`,
      theme.fg("border", "─".repeat(width)),
    ].map(line => truncateToWidth(line, width));
  }

  private row(text: string, active: boolean): string {
    return active ? this.theme.fg("accent", `❯ ${text}`) : `  ${text}`;
  }
}
