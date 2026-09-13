import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { applyChange, listProposals, moveProposal, renderChange, writeProposal, type Proposal } from "./proposals.ts";
import { listResults, renderResults } from "./runner.ts";
import { checkProposal } from "./verify.ts";

export interface Deps {
  agentDir: string;
  evalDir: string;
  sessionsDir: string;
  dbPath: string;
}

function label(p: Proposal): string {
  return `[${p.kind}] ${p.title} (${new Date(p.createdAt).toISOString().slice(0, 10)})`;
}

function describe(agentDir: string, p: Proposal): string {
  const evidence = p.evidence.map((e) => `> ${e.quote.replace(/\n/g, "\n> ")}`).join("\n\n");
  return [
    `# ${p.title}`,
    "",
    `kind: ${p.kind}   source: ${p.source}   sessions: ${p.sessionIds.map((s) => s.slice(0, 8)).join(", ")}`,
    "",
    "## Rationale",
    p.rationale,
    "",
    "## Evidence",
    evidence || "(none)",
    "",
    "## Change",
    renderChange(agentDir, p.change),
    "",
    p.verify ? `verify: ${JSON.stringify(p.verify)}` : "verify: none",
    "",
    "(Close this editor to choose Accept / Edit / Reject / Later)",
  ].join("\n");
}

function editable(p: Proposal): string | undefined {
  const c = p.change;
  if (c.type === "replace") return c.replace;
  if (c.type === "create") return c.content;
  if (c.type === "setting") return c.value;
  if (c.type === "note") return c.text;
  return undefined;
}

function withEdited(p: Proposal, text: string): Proposal {
  const c = p.change;
  if (c.type === "replace") return { ...p, change: { ...c, replace: text } };
  if (c.type === "create") return { ...p, change: { ...c, content: text } };
  if (c.type === "setting") return { ...p, change: { ...c, value: text.trim() } };
  if (c.type === "note") return { ...p, change: { ...c, text } };
  return p;
}

async function accept(ctx: ExtensionCommandContext, deps: Deps, p: Proposal): Promise<boolean> {
  const r = applyChange(deps.agentDir, p.change);
  if (!r.ok) {
    ctx.ui.notify(`eval: apply failed: ${r.error}`, "error");
    return false;
  }
  moveProposal(deps.evalDir, p, "accepted");
  const where = r.path ? `edited ${r.path}` : "recorded note";
  const hint = p.change.type === "setting" ? " (takes effect on next pi start)" : "";
  ctx.ui.notify(`eval: accepted, ${where}${hint}`, "info");
  return true;
}

export async function reviewOne(ctx: ExtensionCommandContext, deps: Deps, p: Proposal): Promise<void> {
  await ctx.ui.editor(label(p), describe(deps.agentDir, p));
  const choice = await ctx.ui.select(p.title, ["Accept", "Edit then accept", "Reject", "Later"]);
  if (choice === "Accept") {
    await accept(ctx, deps, p);
  } else if (choice === "Edit then accept") {
    const current = editable(p);
    if (current === undefined) {
      ctx.ui.notify("eval: this change type cannot be edited, accept or reject it", "warning");
      return;
    }
    const text = await ctx.ui.editor("Edit change", current);
    if (text === undefined) return;
    const edited = withEdited(p, text);
    writeProposal(deps.evalDir, edited);
    await accept(ctx, deps, edited);
  } else if (choice === "Reject") {
    moveProposal(deps.evalDir, p, "rejected");
    ctx.ui.notify("eval: rejected", "info");
  }
}

export async function reviewLoop(ctx: ExtensionCommandContext, deps: Deps, onAudit: () => void): Promise<void> {
  for (;;) {
    const pending = listProposals(deps.evalDir, "pending");
    const options = [...pending.map(label), "Check outcomes", "Run audit", "Done"];
    const choice = await ctx.ui.select(`eval: ${pending.length} pending`, options);
    if (!choice || choice === "Done") return;
    if (choice === "Check outcomes") {
      await checkAll(ctx, deps);
      continue;
    }
    if (choice === "Run audit") {
      onAudit();
      ctx.ui.notify("eval: audit started in background, proposals appear on next /eval", "info");
      continue;
    }
    const p = pending[options.indexOf(choice)];
    if (p) await reviewOne(ctx, deps, p);
  }
}

export async function checkAll(ctx: ExtensionCommandContext, deps: Deps): Promise<void> {
  const applied = listProposals(deps.evalDir, "accepted");
  if (!applied.length) {
    ctx.ui.notify("eval: nothing applied yet", "info");
    return;
  }
  const rows = applied.map((p) => {
    const r = checkProposal(p, deps);
    if (r.outcome !== p.outcome) writeProposal(deps.evalDir, { ...p, outcome: r.outcome });
    return `| ${p.title.slice(0, 40)} | ${p.verify?.kind ?? "-"} | ${r.before.toFixed(2)} | ${r.after.toFixed(2)} | ${r.samples} | ${r.outcome} |`;
  });
  const table = ["| proposal | verify | before | after | sessions | outcome |", "|---|---|---|---|---|---|", ...rows].join("\n");
  await ctx.ui.editor("eval: outcomes", table);
}

export async function showResults(ctx: ExtensionCommandContext, deps: Deps): Promise<void> {
  const results = listResults(deps.evalDir).slice(0, 50);
  if (!results.length) {
    ctx.ui.notify("eval: no results yet, run /eval run", "info");
    return;
  }
  await ctx.ui.editor("eval: results", renderResults(results));
}
