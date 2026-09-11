import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { listProposals } from "./proposals.ts";

function read(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function skills(agentDir: string): string[] {
  const dir = join(agentDir, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory())
    .map((n) => {
      const fm = frontmatter(read(join(dir, n, "SKILL.md")));
      return `- ${fm.name ?? n}: ${fm.description ?? ""} (skills/${n}/SKILL.md)`;
    });
}

function prompts(agentDir: string): string[] {
  const dir = join(agentDir, "prompts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .map((n) => `- ${n.replace(/\.md$/, "")} (prompts/${n})`);
}

export function buildSnapshot(agentDir: string, harnessDir: string): string {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(read(join(agentDir, "settings.json")) || "{}");
  } catch {
    settings = {};
  }
  const titles = (status: "pending" | "accepted" | "rejected"): string[] =>
    listProposals(harnessDir, status)
      .slice(-30)
      .map((p) => `- ${p.title}`);
  return [
    "## AGENTS.md (path: AGENTS.md)",
    "```markdown",
    read(join(agentDir, "AGENTS.md")).trim(),
    "```",
    "",
    "## Skills",
    ...skills(agentDir),
    "",
    "## Prompts",
    ...prompts(agentDir),
    "",
    "## Settings",
    `defaultModel: ${String(settings.defaultModel ?? "")}`,
    `defaultThinkingLevel: ${String(settings.defaultThinkingLevel ?? "")}`,
    "",
    "## Installed packages",
    ...((settings.packages as string[] | undefined) ?? []).map((p) => `- ${p}`),
    "",
    "## Proposals already pending (do not repeat)",
    ...titles("pending"),
    "",
    "## Proposals already applied (do not repeat)",
    ...titles("accepted"),
    "",
    "## Proposals rejected by the user (do not repeat)",
    ...titles("rejected"),
  ].join("\n");
}
