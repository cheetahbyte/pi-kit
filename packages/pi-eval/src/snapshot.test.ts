import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot } from "./snapshot.ts";

describe("buildSnapshot", () => {
  test("includes rules, skills with descriptions, prompts, settings, packages, proposal titles", () => {
    const agent = mkdtempSync(join(tmpdir(), "agent-"));
    const harness = join(agent, "eval");
    writeFileSync(join(agent, "AGENTS.md"), "# Global\n- Never commit\n");
    mkdirSync(join(agent, "skills", "pare"), { recursive: true });
    writeFileSync(join(agent, "skills", "pare", "SKILL.md"), "---\nname: pare\ndescription: Trim prose.\n---\nbody\n");
    mkdirSync(join(agent, "prompts"));
    writeFileSync(join(agent, "prompts", "explore.md"), "x");
    writeFileSync(
      join(agent, "settings.json"),
      JSON.stringify({ defaultModel: "m", defaultThinkingLevel: "low", packages: ["npm:pi-footer"] }),
    );
    mkdirSync(join(harness, "proposals"), { recursive: true });
    writeFileSync(join(harness, "proposals", "a.json"), JSON.stringify({ id: "a", title: "Pending one", status: "pending" }));
    mkdirSync(join(agent, "extensions"));
    writeFileSync(join(agent, "extensions", "trs.ts"), 'export default (pi) => { pi.registerCommand("trs", {}); pi.on("tool_result", () => {}); };');
    mkdirSync(join(agent, "npm", "node_modules", "pi-footer"), { recursive: true });
    writeFileSync(join(agent, "npm", "node_modules", "pi-footer", "package.json"), JSON.stringify({ description: "Footer for pi" }));
    writeFileSync(join(agent, "mcp.json"), JSON.stringify({ mcpServers: { context7: {} } }));
    mkdirSync(join(harness, "cases", "no-commit"), { recursive: true });
    writeFileSync(join(harness, "cases", "no-commit", "prompt.md"), "Fix it without committing.");
    const cwd = mkdtempSync(join(tmpdir(), "proj-"));
    writeFileSync(join(cwd, "CLAUDE.md"), "- project rule");
    const s = buildSnapshot(agent, harness, { cwd });
    expect(s).toContain("- Never commit");
    expect(s).toContain("pare: Trim prose.");
    expect(s).toContain("explore");
    expect(s).toContain("defaultModel: m");
    expect(s).toContain("npm:pi-footer");
    expect(s).toContain("Pending one");
    expect(s).toContain("body");
    expect(s).toContain("extensions/trs.ts: commands /trs; hooks tool_result");
    expect(s).toContain("npm:pi-footer: Footer for pi");
    expect(s).toContain("- context7");
    expect(s).toContain("- no-commit: Fix it without committing.");
    expect(s).toContain("- project rule");
    expect(s).toContain("read-only context");
  });
});
