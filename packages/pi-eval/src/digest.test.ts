import { describe, expect, test } from "bun:test";
import { digestSession, userTextOf } from "./digest.ts";

const lines = [
  JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-01T10:00:00.000Z", cwd: "/p" }),
  JSON.stringify({ type: "message", id: "1", parentId: null, timestamp: "t", message: { role: "user", content: "fix the build" } }),
  JSON.stringify({
    type: "message",
    id: "2",
    parentId: "1",
    timestamp: "t",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret" },
        { type: "text", text: "Looking." },
        { type: "toolCall", id: "c1", name: "bash", arguments: { command: "bun test" } },
      ],
    },
  }),
  JSON.stringify({
    type: "message",
    id: "3",
    parentId: "2",
    timestamp: "t",
    message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "error: nope" }], isError: true },
  }),
  JSON.stringify({ type: "compaction", id: "4", parentId: "3", timestamp: "t", summary: "s", firstKeptEntryId: "1", tokensBefore: 1 }),
  JSON.stringify({ type: "message", id: "5", parentId: "4", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "no, wrong file" }] } }),
];

describe("digestSession", () => {
  test("renders users, assistant text, tool lines, compaction", () => {
    const d = digestSession(lines.join("\n"), 10_000);
    expect(d).toContain("USER: fix the build");
    expect(d).toContain("ASSISTANT: Looking.");
    expect(d).toContain('[bash] {"command":"bun test"} (err: error: nope)');
    expect(d).toContain("--- compaction ---");
    expect(d).toContain("USER: no, wrong file");
    expect(d).not.toContain("secret");
  });

  test("keeps every user message under a tight budget", () => {
    const d = digestSession(lines.join("\n"), 80);
    expect(d).toContain("USER: fix the build");
    expect(d).toContain("USER: no, wrong file");
    expect(d).not.toContain("ASSISTANT:");
  });

  test("truncates long assistant text", () => {
    const long = JSON.stringify({
      type: "message",
      id: "9",
      parentId: "1",
      timestamp: "t",
      message: { role: "assistant", content: [{ type: "text", text: "x".repeat(1000) }] },
    });
    const d = digestSession([lines[0], lines[1], long].join("\n"), 10_000);
    expect(d).toContain("x".repeat(600) + "…");
    expect(d).not.toContain("x".repeat(601));
  });
});

describe("userTextOf", () => {
  test("handles string and block content", () => {
    expect(userTextOf({ role: "user", content: "hi" })).toBe("hi");
    expect(userTextOf({ role: "user", content: [{ type: "text", text: "a" }, { type: "image" }] })).toBe("a");
    expect(userTextOf({ role: "assistant", content: "x" })).toBeUndefined();
  });
});
