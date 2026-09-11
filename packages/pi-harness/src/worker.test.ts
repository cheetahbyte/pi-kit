import { describe, expect, test } from "bun:test";
import { buildAuditPrompt, buildRetroPrompt } from "./worker.ts";

describe("prompts", () => {
  test("retro prompt carries all sections", () => {
    const p = buildRetroPrompt({
      sessionId: "s1",
      digest: "USER: hi",
      snapshot: "## AGENTS.md",
      metrics: { failureLoops: 2 },
      reasons: ["corrections=1"],
    });
    expect(p).toContain("Session id: s1");
    expect(p).toContain("Flag reasons: corrections=1");
    expect(p).toContain('"failureLoops": 2');
    expect(p).toContain("## AGENTS.md");
    expect(p).toContain("USER: hi");
  });

  test("audit prompt renders a table row per session", () => {
    const p = buildAuditPrompt({
      rows: [{ id: "a", date: "2026-09-01", cwd: "/x", corrections: ["no, wrong"], metrics: { toolCalls: 3 } }],
      snapshot: "snap",
    });
    expect(p).toContain("| a | 2026-09-01 | /x | 1 | 3 |");
    expect(p).toContain("no, wrong");
    expect(p).toContain("snap");
  });
});
