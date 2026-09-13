import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type GraderType = "regex" | "tool_used" | "file_exists" | "llm";

export interface Grader {
  name: string;
  type: GraderType;
  target: "last_message" | "trace";
  pattern?: string;
  flags?: string;
  match: "contains" | "not_contains";
  tool?: string;
  inputMatch?: string;
  min?: number;
  max?: number;
  path?: string;
  criteria?: string;
}

export interface EvalCase {
  name: string;
  dir: string;
  prompt: string;
  runs: number;
  model?: string;
  thinking?: string;
  tools: string;
  timeoutSeconds: number;
  ablation: boolean;
  graders: Grader[];
}

export function splitFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["'](.*)["']$/, "$1");
  }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

const TYPES = new Set<string>(["regex", "tool_used", "file_exists", "llm"]);

export function parseGrader(name: string, text: string): Grader | undefined {
  const { meta, body } = splitFrontmatter(text);
  if (!TYPES.has(meta.type)) return undefined;
  const num = (v: string | undefined): number | undefined => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const g: Grader = {
    name,
    type: meta.type as GraderType,
    target: meta.target === "trace" ? "trace" : "last_message",
    match: meta.match === "not_contains" ? "not_contains" : "contains",
    flags: meta.flags,
    tool: meta.tool,
    inputMatch: meta.input_match,
    min: num(meta.min),
    max: num(meta.max),
    path: meta.path,
  };
  const trimmed = body.trim();
  if (g.type === "regex") g.pattern = meta.pattern ?? trimmed;
  if (g.type === "llm") g.criteria = meta.criteria ?? trimmed;
  if (g.type === "regex" && !g.pattern) return undefined;
  if (g.type === "tool_used" && !g.tool) return undefined;
  if (g.type === "file_exists" && !g.path) return undefined;
  if (g.type === "llm" && !g.criteria) return undefined;
  return g;
}

export function loadCase(dir: string): EvalCase | undefined {
  const promptFile = join(dir, "prompt.md");
  if (!existsSync(promptFile)) return undefined;
  const { meta, body } = splitFrontmatter(readFileSync(promptFile, "utf8"));
  const gdir = join(dir, "graders");
  const graders = existsSync(gdir)
    ? readdirSync(gdir)
        .filter((n) => n.endsWith(".md"))
        .map((n) => parseGrader(n.replace(/\.md$/, ""), readFileSync(join(gdir, n), "utf8")))
        .filter((g): g is Grader => g !== undefined)
    : [];
  const runs = Number(meta.runs);
  const timeout = Number(meta.timeout_seconds);
  return {
    name: meta.name || dir.split("/").at(-1) || "case",
    dir,
    prompt: body.trim(),
    runs: Number.isInteger(runs) && runs > 0 ? runs : 1,
    model: meta.model || undefined,
    thinking: meta.thinking || undefined,
    tools: meta.tools || "read",
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : 300,
    ablation: meta.ablation === "with-without",
    graders,
  };
}

export function casesDir(evalDir: string): string {
  return join(evalDir, "cases");
}

export function listCases(evalDir: string, filter?: string): EvalCase[] {
  const root = casesDir(evalDir);
  if (!existsSync(root)) return [];
  const re = filter ? new RegExp(`^${filter.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`) : undefined;
  return readdirSync(root)
    .sort()
    .filter((n) => statSync(join(root, n)).isDirectory() && (!re || re.test(n)))
    .map((n) => loadCase(join(root, n)))
    .filter((c): c is EvalCase => c !== undefined);
}
