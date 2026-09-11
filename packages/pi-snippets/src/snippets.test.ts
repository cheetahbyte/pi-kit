import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSnippetModes, loadSnippets, parseSnippet, saveSnippetModes, type SnippetMode } from "./snippets.js";

test("persists only automatic modes and refuses to overwrite invalid settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-snippets-"));
  const path = join(directory, "snippets.json");
  try {
    expect([...loadSnippetModes(path)]).toEqual([]);
    const modes = new Map<string, SnippetMode>([["a.md", "first"], ["b.md", "every"], ["c.md", "next"]]);
    saveSnippetModes(path, modes);
    expect([...loadSnippetModes(path)]).toEqual([["a.md", "first"], ["b.md", "every"]]);
    expect(readdirSync(directory)).toEqual(["snippets.json"]);
    saveSnippetModes(path, new Map([["a.md", "next"]]));
    expect([...loadSnippetModes(path)]).toEqual([]);

    for (const invalid of ["{broken", "null", "[]", '{"a.md":"next"}', '{"a.md":true}']) {
      writeFileSync(path, invalid);
      expect(() => loadSnippetModes(path)).toThrow();
      expect(() => saveSnippetModes(path, modes)).toThrow();
      expect(readFileSync(path, "utf8")).toBe(invalid);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseSnippet", () => {
  test("parses metadata and body", () => {
    expect(parseSnippet("review.md", `---
name: Review
placement: before
order: 2
---
Check this first.
`)).toEqual({
      id: "review.md",
      name: "Review",
      description: "",
      placement: "before",
      order: 2,
      body: "Check this first.",
    });
  });
});

test("loadSnippets merges directories, later ones override by filename", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-snippets-"));
  try {
    const bundled = join(directory, "bundled");
    const user = join(directory, "user");
    mkdirSync(bundled);
    mkdirSync(user);
    writeFileSync(join(bundled, "a.md"), "---\nname: Bundled A\norder: 1\n---\nbundled");
    writeFileSync(join(bundled, "b.md"), "---\nname: B\norder: 2\n---\nb");
    writeFileSync(join(user, "a.md"), "---\nname: User A\norder: 3\n---\nuser");
    writeFileSync(join(user, "c.md"), "---\nname: C\norder: 0\n---\nc");
    expect(loadSnippets([bundled, user, join(directory, "missing")]).map(({ id, name, body }) => [id, name, body])).toEqual([
      ["c.md", "C", "c"],
      ["b.md", "B", "b"],
      ["a.md", "User A", "user"],
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
