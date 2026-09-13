import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCases, loadCase, parseGrader, splitFrontmatter } from "./cases.ts";

function writeCase(root: string, name: string, prompt: string, graders: Record<string, string> = {}): string {
  const dir = join(root, "cases", name);
  mkdirSync(join(dir, "graders"), { recursive: true });
  writeFileSync(join(dir, "prompt.md"), prompt);
  for (const [g, text] of Object.entries(graders)) writeFileSync(join(dir, "graders", `${g}.md`), text);
  return dir;
}

describe("splitFrontmatter", () => {
  test("parses key: value pairs and strips quotes", () => {
    const { meta, body } = splitFrontmatter('---\nname: "x y"\nruns: 3\n---\nhello\n');
    expect(meta).toEqual({ name: "x y", runs: "3" });
    expect(body).toBe("hello\n");
  });

  test("no frontmatter means whole text is body", () => {
    expect(splitFrontmatter("plain").body).toBe("plain");
  });
});

describe("parseGrader", () => {
  test("regex grader takes pattern from body", () => {
    const g = parseGrader("done", "---\ntype: regex\nflags: i\n---\nsuccess\n");
    expect(g).toMatchObject({ type: "regex", pattern: "success", flags: "i", target: "last_message", match: "contains" });
  });

  test("tool_used grader parses min, max and input_match", () => {
    const g = parseGrader("t", "---\ntype: tool_used\ntool: bash\nmin: 0\nmax: 0\ninput_match: rm -rf\n---\n");
    expect(g).toMatchObject({ type: "tool_used", tool: "bash", min: 0, max: 0, inputMatch: "rm -rf" });
  });

  test("rejects unknown type or missing required field", () => {
    expect(parseGrader("a", "---\ntype: nope\n---\n")).toBeUndefined();
    expect(parseGrader("b", "---\ntype: tool_used\n---\n")).toBeUndefined();
    expect(parseGrader("c", "---\ntype: llm\n---\n")).toBeUndefined();
  });
});

describe("loadCase / listCases", () => {
  test("loads prompt frontmatter, defaults and graders", () => {
    const root = mkdtempSync(join(tmpdir(), "eval-"));
    const dir = writeCase(root, "no-commit", "---\nruns: 2\ntools: read,bash\nablation: with-without\n---\nFix the bug and stop.", {
      "no-git": "---\ntype: tool_used\ntool: bash\nmin: 0\nmax: 0\ninput_match: git commit\n---\n",
      bad: "---\ntype: nope\n---\n",
    });
    const c = loadCase(dir);
    expect(c).toMatchObject({ name: "no-commit", runs: 2, tools: "read,bash", ablation: true, timeoutSeconds: 300, prompt: "Fix the bug and stop." });
    expect(c?.graders.map((g) => g.name)).toEqual(["no-git"]);
  });

  test("listCases filters by glob and skips dirs without prompt.md", () => {
    const root = mkdtempSync(join(tmpdir(), "eval-"));
    writeCase(root, "auth-login", "a");
    writeCase(root, "auth-logout", "b");
    writeCase(root, "other", "c");
    mkdirSync(join(root, "cases", "empty"));
    expect(listCases(root).map((c) => c.name)).toEqual(["auth-login", "auth-logout", "other"]);
    expect(listCases(root, "auth*").map((c) => c.name)).toEqual(["auth-login", "auth-logout"]);
    expect(listCases(join(root, "missing"))).toEqual([]);
  });
});
