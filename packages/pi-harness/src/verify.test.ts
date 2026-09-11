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
    const r = checkProposal(p, { sessionsDir: dir, dbPath: join(dir, "none.db") });
    expect(r.samples).toBe(10);
    expect(r.before).toBe(1);
    expect(r.after).toBe(0);
    expect(r.outcome).toBe("improved");
  });
});
