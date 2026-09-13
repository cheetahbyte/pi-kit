import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessionFiles, readUserMessages } from "./sessions.ts";

function make(dir: string, slug: string, name: string, ts: string, id: string, users: string[]) {
  mkdirSync(join(dir, slug), { recursive: true });
  const lines = [JSON.stringify({ type: "session", version: 3, id, timestamp: ts, cwd: "/" + slug })];
  for (const u of users) {
    lines.push(JSON.stringify({ type: "message", id: "x", parentId: null, timestamp: ts, message: { role: "user", content: u } }));
  }
  writeFileSync(join(dir, slug, name), lines.join("\n") + "\n");
}

describe("sessions", () => {
  test("lists across cwd dirs newest first with since filter", () => {
    const dir = mkdtempSync(join(tmpdir(), "sess-"));
    make(dir, "--a--", "2026-09-01T10-00-00-000Z_1.jsonl", "2026-09-01T10:00:00.000Z", "1", ["one"]);
    make(dir, "--b--", "2026-09-03T10-00-00-000Z_2.jsonl", "2026-09-03T10:00:00.000Z", "2", ["two", "no, wrong"]);
    const all = listSessionFiles(dir);
    expect(all.map((s) => s.id)).toEqual(["2", "1"]);
    const since = listSessionFiles(dir, { since: Date.parse("2026-09-02T00:00:00Z") });
    expect(since.map((s) => s.id)).toEqual(["2"]);
    expect(readUserMessages(since[0].path)).toEqual(["two", "no, wrong"]);
  });
});

describe("session model", () => {
  test("reads provider/model from the first model_change entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "sess-"));
    mkdirSync(join(dir, "--m--"));
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "9", timestamp: "2026-09-01T10:00:00.000Z", cwd: "/m" }),
      JSON.stringify({ type: "model_change", provider: "openai-codex", modelId: "gpt-6-astra" }),
    ];
    writeFileSync(join(dir, "--m--", "s.jsonl"), lines.join("\n") + "\n");
    expect(listSessionFiles(dir)[0].model).toBe("openai-codex/gpt-6-astra");
  });
});
