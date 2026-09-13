import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalCase } from "./cases.ts";
import { gradeRun, listResults, parseTrace, renderResults, writeResult, type CaseResult, type RunResult } from "./runner.ts";

const agentEnd = JSON.stringify({
  type: "agent_end",
  messages: [
    { role: "user", content: [{ type: "text", text: "do it" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Looking." },
        { type: "toolCall", id: "1", name: "bash", arguments: { command: "git status" } },
      ],
      usage: { totalTokens: 100, cost: { total: 0.01 } },
    },
    { role: "toolResult", toolCallId: "1", toolName: "bash", isError: true, content: [{ type: "text", text: "fatal: not a repo" }] },
    { role: "assistant", content: [{ type: "text", text: "Done, nothing committed." }], usage: { totalTokens: 50, cost: { total: 0.005 } } },
  ],
});

describe("parseTrace", () => {
  test("reads agent_end messages into trace, last message and usage", () => {
    const t = parseTrace(`{"type":"agent_start"}\nnot json\n${agentEnd}\n`);
    expect(t.lastMessage).toBe("Done, nothing committed.");
    expect(t.toolCalls).toBe(1);
    expect(t.tokens).toBe(150);
    expect(t.cost).toBeCloseTo(0.015);
    expect(t.trace.map((x) => x.kind)).toEqual(["assistant", "tool", "result", "assistant"]);
    expect(t.trace[2]).toMatchObject({ tool: "bash", isError: true });
  });

  test("falls back to message_end events when agent_end is missing", () => {
    const line = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });
    expect(parseTrace(line).lastMessage).toBe("hi");
  });
});

function fakeRun(workspace: string): RunResult {
  return { arm: "with", run: 1, status: "completed", durationMs: 1, workspace, ...parseTrace(agentEnd) };
}

const judge = { model: "m", thinking: "off", timeoutMs: 1000, cwd: tmpdir() };

describe("gradeRun", () => {
  test("regex, tool_used and file_exists graders score deterministically", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ws-"));
    writeFileSync(join(ws, "notes.md"), "x");
    const c: EvalCase = {
      name: "c",
      dir: ws,
      prompt: "p",
      runs: 1,
      tools: "read",
      timeoutSeconds: 1,
      ablation: false,
      graders: [
        { name: "says-done", type: "regex", target: "last_message", pattern: "done", flags: "i", match: "contains" },
        { name: "no-error-word", type: "regex", target: "trace", pattern: "fatal", match: "not_contains" },
        { name: "no-commit", type: "tool_used", target: "last_message", match: "contains", tool: "bash", min: 0, max: 0, inputMatch: "git commit" },
        { name: "used-bash", type: "tool_used", target: "last_message", match: "contains", tool: "bash", min: 2 },
        { name: "wrote-notes", type: "file_exists", target: "last_message", match: "contains", path: "*.md" },
      ],
    };
    const g = await gradeRun(c, fakeRun(ws), judge);
    expect(g.graders.map((x) => [x.name, x.passed])).toEqual([
      ["says-done", true],
      ["no-error-word", false],
      ["no-commit", true],
      ["used-bash", false],
      ["wrote-notes", true],
    ]);
    expect(g.score).toBeCloseTo(0.6);
  });

  test("a failed run fails every grader", async () => {
    const c: EvalCase = { name: "c", dir: "", prompt: "p", runs: 1, tools: "read", timeoutSeconds: 1, ablation: false, graders: [
      { name: "x", type: "regex", target: "last_message", pattern: ".", match: "contains" },
    ] };
    const g = await gradeRun(c, { ...fakeRun(""), status: "timeout" }, judge);
    expect(g.graders[0]).toMatchObject({ passed: false, reason: "run timeout" });
    expect(g.score).toBe(0);
  });
});

describe("results", () => {
  test("writeResult / listResults / renderResults round trip", () => {
    const evalDir = mkdtempSync(join(tmpdir(), "eval-"));
    const mk = (name: string, createdAt: number, score: number): CaseResult => ({
      name,
      createdAt,
      model: "m",
      score,
      baselineScore: 0.5,
      arms: { with: [{ ...fakeRun(""), graders: [{ name: "g", type: "regex", passed: score === 1, reason: "" }], score }] },
    });
    writeResult(evalDir, "b1", mk("a", 1000, 0));
    writeResult(evalDir, "b2", mk("a", 2000, 1));
    writeResult(evalDir, "b2", mk("b", 2000, 1));
    mkdirSync(join(evalDir, "results", "junk"));
    expect(listResults(evalDir).map((r) => [r.name, r.createdAt])).toEqual([["a", 2000], ["b", 2000], ["a", 1000]]);
    expect(listResults(evalDir, { name: "a", since: 1500 })).toHaveLength(1);
    const table = renderResults(listResults(evalDir, { name: "a" }));
    expect(table).toContain("| a | 1970-01-01T00:00 | m | 1.00 | 0.50 | 1 | 1.0 | 150 |  |");
    expect(table).toContain("| 0.00 | 0.50 | 1 | 1.0 | 150 | g |");
  });
});
