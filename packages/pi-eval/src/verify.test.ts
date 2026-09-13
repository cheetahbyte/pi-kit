import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Proposal } from "./proposals.ts";
import { checkProposal, outcomeFor } from "./verify.ts";

describe("outcomeFor", () => {
  test("needs 10 samples", () => {
    expect(outcomeFor({ before: 1, after: 0, direction: "down", samples: 9 })).toBe("insufficient-data");
  });
  test("thresholds", () => {
    expect(outcomeFor({ before: 1, after: 0.7, direction: "down", samples: 10 })).toBe("improved");
    expect(outcomeFor({ before: 1, after: 0.9, direction: "down", samples: 10 })).toBe("unchanged");
    expect(outcomeFor({ before: 1, after: 1.3, direction: "down", samples: 10 })).toBe("worse");
    expect(outcomeFor({ before: 1, after: 1.3, direction: "up", samples: 10 })).toBe("improved");
    expect(outcomeFor({ before: 0, after: 0, direction: "down", samples: 10 })).toBe("unchanged");
    expect(outcomeFor({ before: 0, after: 0.5, direction: "down", samples: 10 })).toBe("worse");
  });
});

describe("checkProposal correction", () => {
  test("counts pattern matches per session before and after", () => {
    const dir = mkdtempSync(join(tmpdir(), "vsess-"));
    mkdirSync(join(dir, "--p--"));
    const mk = (id: string, ts: string, users: string[]) =>
      writeFileSync(
        join(dir, "--p--", `${ts.replaceAll(":", "-")}_${id}.jsonl`),
        [
          JSON.stringify({ type: "session", version: 3, id, timestamp: ts, cwd: "/p" }),
          ...users.map((u) =>
            JSON.stringify({ type: "message", id: "x", parentId: null, timestamp: ts, message: { role: "user", content: u } }),
          ),
        ].join("\n"),
      );
    for (let i = 0; i < 5; i++) mk(`b${i}`, `2026-08-0${i + 1}T10:00:00.000Z`, ["no, use bun test"]);
    for (let i = 0; i < 10; i++) mk(`a${i}`, `2026-09-${String(i + 2).padStart(2, "0")}T10:00:00.000Z`, ["fine"]);
    const p: Proposal = {
      id: "x",
      createdAt: 0,
      source: "retro",
      sessionIds: [],
      kind: "agents-rule",
      title: "t",
      rationale: "",
      evidence: [],
      change: { type: "note", text: "" },
      verify: { kind: "correction", pattern: "bun test" },
      status: "accepted",
      appliedAt: Date.parse("2026-09-01T00:00:00Z"),
    };
    const r = checkProposal(p, { sessionsDir: dir, dbPath: join(dir, "none.db"), evalDir: join(dir, "eval") });
    expect(r.samples).toBe(10);
    expect(r.before).toBe(1);
    expect(r.after).toBe(0);
    expect(r.outcome).toBe("improved");
  });
});

describe("checkProposal eval", () => {
  const base = (verify: Proposal["verify"]): Proposal => ({
    id: "e",
    createdAt: 0,
    source: "retro",
    sessionIds: [],
    kind: "eval-case",
    title: "t",
    rationale: "",
    evidence: [],
    change: { type: "note", text: "" },
    verify,
    status: "accepted",
    appliedAt: 1000,
  });
  const deps = (evalDir: string) => ({ sessionsDir: join(evalDir, "none"), dbPath: join(evalDir, "none.db"), evalDir });
  const result = (createdAt: number, score: number, baselineScore?: number) =>
    JSON.stringify({ name: "c", createdAt, model: "m", score, baselineScore, arms: { with: [{}, {}] } });

  test("no run after apply means insufficient data", () => {
    const evalDir = mkdtempSync(join(tmpdir(), "veval-"));
    mkdirSync(join(evalDir, "results", "old"), { recursive: true });
    writeFileSync(join(evalDir, "results", "old", "c.json"), result(500, 1));
    expect(checkProposal(base({ kind: "eval", case: "c" }), deps(evalDir)).outcome).toBe("insufficient-data");
  });

  test("without baseline a full score is improved, anything else worse", () => {
    const evalDir = mkdtempSync(join(tmpdir(), "veval-"));
    mkdirSync(join(evalDir, "results", "new"), { recursive: true });
    writeFileSync(join(evalDir, "results", "new", "c.json"), result(2000, 0.5));
    const r = checkProposal(base({ kind: "eval", case: "c" }), deps(evalDir));
    expect(r).toMatchObject({ outcome: "worse", after: 0.5, samples: 2 });
  });

  test("with a baseline the delta decides", () => {
    const evalDir = mkdtempSync(join(tmpdir(), "veval-"));
    mkdirSync(join(evalDir, "results", "new"), { recursive: true });
    writeFileSync(join(evalDir, "results", "new", "c.json"), result(2000, 1, 0.5));
    expect(checkProposal(base({ kind: "eval", case: "c" }), deps(evalDir)).outcome).toBe("improved");
    expect(checkProposal(base({ kind: "eval", case: "c", baseline: 0.9 }), deps(evalDir)).outcome).toBe("unchanged");
  });
});
