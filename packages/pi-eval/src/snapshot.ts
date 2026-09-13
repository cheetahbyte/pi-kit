import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { listCases } from "./cases.ts";
import { listProposals } from "./proposals.ts";

const BODY_CHARS = 1500;

function read(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function clip(text: string, max = BODY_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const lines = t.split("\n").length;
  return `${t.slice(0, max)}\n… (${lines} lines total, truncated)`;
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

function dirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
}

function files(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(ext) && statSync(join(dir, n)).isFile());
}

function skillEntry(dir: string, name: string, relPath: string, full: boolean): string {
  const text = read(join(dir, name, "SKILL.md"));
  const fm = frontmatter(text);
  const head = `### ${fm.name ?? name}: ${fm.description ?? ""} (${relPath})`;
  if (!full) return head;
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return `${head}\n\`\`\`markdown\n${clip(body)}\n\`\`\``;
}

function skills(agentDir: string): string[] {
  const dir = join(agentDir, "skills");
  return dirs(dir).map((n) => skillEntry(dir, n, `skills/${n}/SKILL.md`, true));
}

function prompts(agentDir: string): string[] {
  const dir = join(agentDir, "prompts");
  return files(dir, ".md").map((n) => `### ${n.replace(/\.md$/, "")} (prompts/${n})\n\`\`\`markdown\n${clip(read(join(dir, n)))}\n\`\`\``);
}

function snippets(agentDir: string): string[] {
  const dir = join(agentDir, "snippets");
  return files(dir, ".md").map((n) => `- ${n}: ${clip(read(join(dir, n)), 200).replace(/\n/g, " ")}`);
}

function localExtensions(agentDir: string): string[] {
  const dir = join(agentDir, "extensions");
  return files(dir, ".ts").map((n) => {
    const src = read(join(dir, n));
    const commands = [...src.matchAll(/registerCommand\(\s*["']([^"']+)["']/g)].map((m) => `/${m[1]}`);
    const tools = [...src.matchAll(/registerTool\(\s*\{[^}]*?name:\s*["']([^"']+)["']/gs)].map((m) => m[1]);
    const events = [...new Set([...src.matchAll(/\.on\(\s*["']([^"']+)["']/g)].map((m) => m[1]))];
    const parts = [
      commands.length ? `commands ${commands.join(" ")}` : "",
      tools.length ? `tools ${tools.join(", ")}` : "",
      events.length ? `hooks ${events.join(", ")}` : "",
    ].filter(Boolean);
    return `- extensions/${n}: ${parts.join("; ") || "(no commands, tools or hooks detected)"}`;
  });
}

function packageDir(agentDir: string, spec: string): string | undefined {
  if (spec.startsWith("npm:")) return join(agentDir, "npm", "node_modules", spec.slice(4));
  if (spec.startsWith("git:")) {
    const u = spec.slice(4).replace(/^https?:\/\//, "").replace(/\.git$/, "");
    return join(agentDir, "git", u);
  }
  return undefined;
}

function packages(agentDir: string, specs: string[]): string[] {
  return specs.flatMap((spec) => {
    const dir = packageDir(agentDir, spec);
    let manifest: { description?: string; pi?: { extensions?: string[]; skills?: string[] } } = {};
    try {
      manifest = dir ? JSON.parse(read(join(dir, "package.json")) || "{}") : {};
    } catch {
      manifest = {};
    }
    const head = `- ${spec}: ${(manifest.description ?? "").slice(0, 120)}`;
    const skillLines = (manifest.pi?.skills ?? []).flatMap((s) => {
      const sd = join(dir ?? "", s);
      return dirs(sd).map((n) => `  ${skillEntry(sd, n, `${spec} ${s}/${n}`, false)}`);
    });
    return [head, ...skillLines];
  });
}

function mcpServers(agentDir: string): string[] {
  try {
    const cfg = JSON.parse(read(join(agentDir, "mcp.json")) || "{}") as { mcpServers?: Record<string, unknown> };
    return Object.keys(cfg.mcpServers ?? {}).map((n) => `- ${n}`);
  } catch {
    return [];
  }
}

function projectContext(cwd: string | undefined): string[] {
  if (!cwd) return [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = join(cwd, name);
    if (existsSync(file)) {
      return [
        `## Project ${name} (path: ${file}, read-only context, not editable by proposals)`,
        "```markdown",
        clip(read(file), 3000),
        "```",
        "",
      ];
    }
  }
  return [];
}

export function buildSnapshot(agentDir: string, evalDir: string, opts: { cwd?: string } = {}): string {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(read(join(agentDir, "settings.json")) || "{}");
  } catch {
    settings = {};
  }
  const titles = (status: "pending" | "accepted" | "rejected"): string[] =>
    listProposals(evalDir, status)
      .slice(-30)
      .map((p) => `- ${p.title}`);
  const cases = listCases(evalDir).map((c) => `- ${c.name}: ${c.prompt.split("\n")[0]?.slice(0, 100) ?? ""}`);
  return [
    "## AGENTS.md (path: AGENTS.md)",
    "```markdown",
    read(join(agentDir, "AGENTS.md")).trim(),
    "```",
    "",
    ...projectContext(opts.cwd),
    "## Skills (editable; bodies truncated)",
    ...skills(agentDir),
    "",
    "## Prompts (editable)",
    ...prompts(agentDir),
    "",
    "## Snippets (read-only)",
    ...snippets(agentDir),
    "",
    "## Local extensions (read-only; report issues as extension-issue)",
    ...localExtensions(agentDir),
    "",
    "## Settings",
    `defaultProvider: ${String(settings.defaultProvider ?? "")}`,
    `defaultModel: ${String(settings.defaultModel ?? "")}`,
    `defaultThinkingLevel: ${String(settings.defaultThinkingLevel ?? "")}`,
    `enabledModels: ${((settings.enabledModels as string[] | undefined) ?? []).join(", ")}`,
    "",
    "## Installed packages (read-only; report issues as extension-issue)",
    ...packages(agentDir, (settings.packages as string[] | undefined) ?? []),
    "",
    "## MCP servers",
    ...mcpServers(agentDir),
    "",
    "## Eval cases (path: eval/cases/<name>/prompt.md)",
    ...(cases.length ? cases : ["(none yet)"]),
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
