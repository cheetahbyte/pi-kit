# Ask user question

A Pi extension that registers `ask_user_question`. Inspired by Claude Code's structured questions and [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question), with an optional model-authored question on a separate **Notes** tab.

## Load the extension

From the repository root, try it for one session:

```sh
pi -e ./packages/pi-ask-user-question/src/index.ts
```

To install the local package:

```sh
pi install ./packages/pi-ask-user-question
```

If Pi already loads this repository as a package, its extension glob includes this package. Don't also load another extension that registers `ask_user_question`.

## Ask questions

The tool accepts 1–4 questions, each with a header of up to 16 characters and 2–4 options. Each option has a label of up to 60 characters and a description. Set `multiSelect` for multiple choices. Add Markdown `preview` content to single-select options to compare artifacts.

Every question includes **Type something.** for a custom answer. Don't author options named **Other**, **Type something.**, or **Next**.

Supply `finalQuestion` when you want additional context that doesn't fit the structured questions:

```json
{
  "questions": [
    {
      "header": "Scope",
      "question": "How much should change?",
      "options": [
        { "label": "Minimal", "description": "Change only the requested behavior." },
        { "label": "Broader", "description": "Include the related cleanup." }
      ]
    }
  ],
  "finalQuestion": "Any constraints or additional context we should account for?"
}
```

The flow is **Scope → Notes → Submit**. The **Notes** tab displays the supplied prompt and a multiline editor. Notes are optional, survive tab switches, and appear in the answer review. Omit `finalQuestion` to omit the tab entirely, even for a single-question questionnaire.

## Use the keyboard

| Key | Action |
| --- | --- |
| Up / Down | Move between options. |
| Enter | Select an option; toggle a multi-select option; open **Type something.**; or finish editing. |
| Space | Toggle a multi-select option. Select **Next** to continue. |
| Tab / Shift+Tab | Move between tabs without submitting. |
| Left / Right | Move between tabs when not editing text. |
| Shift+Enter | Insert a newline in an editor. |
| Page Up / Page Down | Scroll content that doesn't fit. |
| Esc | Cancel the questionnaire and discard its answers. |

The selection controls and editor honor Pi's corresponding keybindings; the table shows defaults. **Submit answers** sends the result only after every structured question has an answer. The notes question never blocks submission.

Previews appear beside options in wide terminals and stack in narrower ones. Custom answers use the full content width. The active tab remains identifiable in narrow terminals.

## Read the result

The tool returns JSON text and matching result details:

```json
{
  "cancelled": false,
  "answers": [
    {
      "questionIndex": 0,
      "question": "How much should change?",
      "kind": "option",
      "selected": ["Minimal"]
    }
  ],
  "additionalContext": {
    "question": "Any constraints or additional context we should account for?",
    "text": "Keep it usable offline."
  }
}
```

`kind` is `option`, `multi`, or `custom`. Custom answers use `text` and an empty `selected` array. Blank notes omit `additionalContext`. Cancellation returns `{ "cancelled": true, "answers": [] }`, without drafts.

This is an independent terminal implementation, not a drop-in fork of RPIV. It doesn't include RPIV's localization, per-question notes, collapse shortcut, external-editor integration, or native RPC dialogs. Outside interactive terminal mode, calls fail with guidance to ask in chat instead.

## Verify the package

```sh
bun run --cwd packages/pi-ask-user-question typecheck
bun run --cwd packages/pi-ask-user-question test
```

Tests use Pi's editor and terminal renderer with an in-memory terminal boundary. They don't make network requests or model calls.
