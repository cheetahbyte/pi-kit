import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { listProposals, parseProposals, writeProposal } from "./proposals.ts";
import { reviewOne, type Deps } from "./review.ts";

function setup(choices: string[], editorReturns?: string) {
  const agentDir = mkdtempSync(join(tmpdir(), "ragent-"));
  writeFileSync(join(agentDir, "AGENTS.md"), "# Rules\n- Never commit\n");
  const deps: Deps = { agentDir, evalDir: join(agentDir, "eval"), sessionsDir: join(agentDir, "sessions"), dbPath: "" };
  const p = parseProposals(
    JSON.stringify([
      {
        kind: "agents-rule",
        title: "Add bun rule",
        rationale: "r",
        evidence: [],
        change: { type: "replace", path: "AGENTS.md", search: "- Never commit", replace: "- Never commit\n- Use bun" },
      },
    ]),
    { source: "retro", sessionIds: ["s"], existingTitles: [] },
  )[0];
  writeProposal(deps.evalDir, p);
  const notices: string[] = [];
  let editorCalls = 0;
  const ctx = {
    ui: {
      editor: async (_t: string, prefill: string) => (++editorCalls === 1 ? prefill : editorReturns),
      select: async () => choices.shift(),
      notify: (m: string) => notices.push(m),
    },
  } as unknown as ExtensionCommandContext;
  return { deps, p, ctx, notices, agentDir };
}

describe("reviewOne", () => {
  test("accept applies and moves to applied", async () => {
    const { deps, p, ctx, notices, agentDir } = setup(["Accept"]);
    await reviewOne(ctx, deps, p);
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toContain("- Use bun");
    expect(listProposals(deps.evalDir, "pending")).toEqual([]);
    expect(listProposals(deps.evalDir, "accepted")).toHaveLength(1);
    expect(notices[0]).toContain("accepted");
  });

  test("edit then accept uses edited text", async () => {
    const { deps, p, ctx, agentDir } = setup(["Edit then accept"], "- Never commit\n- Use bun test");
    await reviewOne(ctx, deps, p);
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toContain("- Use bun test");
    expect(listProposals(deps.evalDir, "accepted")[0].change).toMatchObject({ replace: "- Never commit\n- Use bun test" });
  });

  test("reject moves without touching files", async () => {
    const { deps, p, ctx, agentDir } = setup(["Reject"]);
    await reviewOne(ctx, deps, p);
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# Rules\n- Never commit\n");
    expect(listProposals(deps.evalDir, "rejected")).toHaveLength(1);
  });

  test("later leaves it pending", async () => {
    const { deps, p, ctx } = setup(["Later"]);
    await reviewOne(ctx, deps, p);
    expect(listProposals(deps.evalDir, "pending")).toHaveLength(1);
  });
});
