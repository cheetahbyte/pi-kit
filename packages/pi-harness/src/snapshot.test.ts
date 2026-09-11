import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot } from "./snapshot.ts";

describe("buildSnapshot", () => {
  test("includes rules, skills with descriptions, prompts, settings, packages, proposal titles", () => {
    const agent = mkdtempSync(join(tmpdir(), "agent-"));
    const harness = join(agent, "harness");
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
    const s = buildSnapshot(agent, harness);
    expect(s).toContain("- Never commit");
    expect(s).toContain("pare: Trim prose.");
    expect(s).toContain("explore");
    expect(s).toContain("defaultModel: m");
    expect(s).toContain("npm:pi-footer");
    expect(s).toContain("Pending one");
  });
});
