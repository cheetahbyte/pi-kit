import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChange, listProposals, moveProposal, parseProposals, writeProposal } from "./proposals.ts";

const ctx = { source: "retro" as const, sessionIds: ["s1"], existingTitles: ["Already There"] };

const valid = {
  kind: "agents-rule",
  title: "Prefer bun test",
  rationale: "User corrected npm test twice.",
  evidence: [{ sessionId: "s1", quote: "no, use bun test" }],
  change: { type: "replace", path: "AGENTS.md", search: "- Never commit", replace: "- Never commit\n- Run tests with bun test" },
  verify: { kind: "correction", pattern: "bun test" },
};

describe("parseProposals", () => {
  test("parses a fenced json array and assigns ids", () => {
    const raw = "Here you go:\n```json\n" + JSON.stringify([valid]) + "\n```\n";
    const ps = parseProposals(raw, ctx);
    expect(ps).toHaveLength(1);
    expect(ps[0].status).toBe("pending");
    expect(ps[0].sessionIds).toEqual(["s1"]);
    expect(ps[0].id).toMatch(/^\d{8}-[0-9a-f]{6}$/);
  });

  test("accepts a bare array without fences", () => {
    expect(parseProposals(JSON.stringify([valid]), ctx)).toHaveLength(1);
  });

  test("drops bad kinds, disallowed paths, duplicate titles, and caps at 5", () => {
    const items = [
      { ...valid, kind: "code-edit" },
      { ...valid, change: { ...valid.change, path: "extensions/x.ts" } },
      { ...valid, change: { ...valid.change, path: "../AGENTS.md" } },
      { ...valid, title: "already there" },
      ...Array.from({ length: 7 }, (_, i) => ({ ...valid, title: `Rule ${i}` })),
    ];
    const ps = parseProposals(JSON.stringify(items), ctx);
    expect(ps.map((p) => p.title)).toEqual(["Rule 0", "Rule 1", "Rule 2", "Rule 3", "Rule 4"]);
  });

  test("setting change only allows two keys", () => {
    const ok = { ...valid, kind: "setting", change: { type: "setting", key: "defaultThinkingLevel", value: "medium" } };
    const bad = { ...valid, kind: "setting", title: "b", change: { type: "setting", key: "packages", value: "x" } };
    expect(parseProposals(JSON.stringify([ok, bad]), ctx)).toHaveLength(1);
  });

  test("returns empty on garbage", () => {
    expect(parseProposals("nothing here", ctx)).toEqual([]);
  });
});

describe("store", () => {
  test("write, list, move", () => {
    const dir = mkdtempSync(join(tmpdir(), "hstore-"));
    const p = parseProposals(JSON.stringify([valid]), ctx)[0];
    writeProposal(dir, p);
    expect(listProposals(dir, "pending").map((x) => x.id)).toEqual([p.id]);
    moveProposal(dir, p, "accepted");
    expect(listProposals(dir, "pending")).toEqual([]);
    const acc = listProposals(dir, "accepted");
    expect(acc[0].status).toBe("accepted");
    expect(typeof acc[0].appliedAt).toBe("number");
  });
});

describe("applyChange", () => {
  function agent() {
    const dir = mkdtempSync(join(tmpdir(), "hagent-"));
    writeFileSync(join(dir, "AGENTS.md"), "# Rules\n- Never commit\n- Be terse\n");
    mkdirSync(join(dir, "skills"));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultModel: "a", packages: ["x"] }, null, 2));
    return dir;
  }

  test("replace edits once", () => {
    const dir = agent();
    const r = applyChange(dir, valid.change as never);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("- Run tests with bun test");
  });

  test("replace fails when search is not unique or missing", () => {
    const dir = agent();
    writeFileSync(join(dir, "AGENTS.md"), "- Be terse\n- Be terse\n");
    const r = applyChange(dir, { type: "replace", path: "AGENTS.md", search: "- Be terse", replace: "x" });
    expect(r.ok).toBe(false);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("- Be terse\n- Be terse\n");
    expect(applyChange(dir, { type: "replace", path: "AGENTS.md", search: "zzz", replace: "x" }).ok).toBe(false);
  });

  test("replace matches across a line wrap", () => {
    const dir = agent();
    writeFileSync(join(dir, "AGENTS.md"), "The main agent should explore,\nimplement, and validate itself.\n");
    const r = applyChange(dir, {
      type: "replace",
      path: "AGENTS.md",
      search: "The main agent should explore, implement, and validate itself.",
      replace: "Do the work.",
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("Do the work.\n");
  });

  test("replace keeps dollar signs literal", () => {
    const dir = agent();
    expect(applyChange(dir, { type: "replace", path: "AGENTS.md", search: "- Be terse", replace: "- Use $HOME" }).ok).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("- Use $HOME");
  });

  test("create writes a new skill and refuses to overwrite", () => {
    const dir = agent();
    const c = { type: "create" as const, path: "skills/foo/SKILL.md", content: "---\nname: foo\n---\nhi\n" };
    expect(applyChange(dir, c).ok).toBe(true);
    expect(existsSync(join(dir, "skills/foo/SKILL.md"))).toBe(true);
    expect(applyChange(dir, c).ok).toBe(false);
  });

  test("delete-block removes the block", () => {
    const dir = agent();
    expect(applyChange(dir, { type: "delete-block", path: "AGENTS.md", search: "- Be terse\n" }).ok).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("# Rules\n- Never commit\n");
  });

  test("setting patches one key and keeps the rest", () => {
    const dir = agent();
    expect(applyChange(dir, { type: "setting", key: "defaultModel", value: "b" }).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).toEqual({ defaultModel: "b", packages: ["x"] });
  });

  test("note changes nothing", () => {
    const dir = agent();
    expect(applyChange(dir, { type: "note", text: "pi-subagents drops results" })).toEqual({ ok: true, path: "" });
  });

  test("paths outside allowed roots are refused", () => {
    const dir = agent();
    expect(applyChange(dir, { type: "create", path: "extensions/evil.ts", content: "" }).ok).toBe(false);
    expect(applyChange(dir, { type: "create", path: "skills/../auth.json", content: "" }).ok).toBe(false);
  });
});
