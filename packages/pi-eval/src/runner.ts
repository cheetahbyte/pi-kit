import { existsSync, globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalCase, Grader } from "./cases.ts";
import { runModel, runPi } from "./pi.ts";

export type Arm = "with" | "without";

export interface TraceEntry {
  kind: "assistant" | "tool" | "result";
  text: string;
  tool?: string;
  input?: string;
  isError?: boolean;
}

export interface RunResult {
  arm: Arm;
  run: number;
  status: "completed" | "error" | "timeout";
  lastMessage: string;
  trace: TraceEntry[];
  toolCalls: number;
  tokens: number;
  cost: number;
  durationMs: number;
  workspace: string;
  error?: string;
}

export interface GradeResult {
  name: string;
  type: Grader["type"];
  passed: boolean;
  reason: string;
}

export interface GradedRun extends RunResult {
  graders: GradeResult[];
  score: number;
}

export interface CaseResult {
  name: string;
  createdAt: number;
  model: string;
  arms: Partial<Record<Arm, GradedRun[]>>;
  score: number;
  baselineScore?: number;
}

type Block = { type: string; text?: string; name?: string; id?: string; arguments?: unknown };
type Msg = { role?: string; content?: string | Block[]; toolName?: string; isError?: boolean; usage?: { totalTokens?: number; cost?: { total?: number } } };

export function parseTrace(stdout: string): Pick<RunResult, "lastMessage" | "trace" | "toolCalls" | "tokens" | "cost"> {
  const trace: TraceEntry[] = [];
  let lastMessage = "";
  let tokens = 0;
  let cost = 0;
  let messages: Msg[] | undefined;
  const ended: Msg[] = [];
  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    let e: { type?: string; messages?: Msg[]; message?: Msg };
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    if (e.type === "agent_end" && Array.isArray(e.messages)) messages = e.messages;
    else if (e.type === "message_end" && e.message) ended.push(e.message);
  }
  for (const m of messages ?? ended) {
    const blocks = Array.isArray(m.content) ? m.content : m.content ? [{ type: "text", text: m.content }] : [];
    if (m.role === "assistant") {
      tokens += m.usage?.totalTokens ?? 0;
      cost += m.usage?.cost?.total ?? 0;
      for (const b of blocks) {
        if (b.type === "text" && b.text?.trim()) {
          trace.push({ kind: "assistant", text: b.text });
          lastMessage = b.text;
        } else if (b.type === "toolCall" && b.name) {
          trace.push({ kind: "tool", tool: b.name, input: JSON.stringify(b.arguments ?? {}), text: "" });
        }
      }
    } else if (m.role === "toolResult") {
      const text = blocks.map((b) => b.text ?? "").join("\n");
      trace.push({ kind: "result", tool: m.toolName, text, isError: Boolean(m.isError) });
    }
  }
  return { lastMessage, trace, toolCalls: trace.filter((t) => t.kind === "tool").length, tokens, cost };
}

export function traceText(trace: TraceEntry[]): string {
  return trace
    .map((t) => {
      if (t.kind === "assistant") return `ASSISTANT: ${t.text}`;
      if (t.kind === "tool") return `[${t.tool}] ${t.input}`;
      return `[${t.tool} result${t.isError ? " ERROR" : ""}] ${t.text.slice(0, 500)}`;
    })
    .join("\n");
}

export async function runCase(
  c: EvalCase,
  arm: Arm,
  run: number,
  opts: { model: string; thinking: string; workRoot: string },
): Promise<RunResult> {
  mkdirSync(opts.workRoot, { recursive: true });
  const workspace = mkdtempSync(join(opts.workRoot, `${c.name}-${arm}-${run}-`));
  const fixtures = join(c.dir, "fixtures");
  if (existsSync(fixtures)) copyDir(fixtures, workspace);
  const args = ["--mode", "json", "--no-session", "--tools", c.tools, "--model", c.model ?? opts.model, "--thinking", c.thinking ?? opts.thinking];
  if (arm === "without") args.push("--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates");
  const r = await runPi({ args, prompt: c.prompt, cwd: workspace, timeoutMs: c.timeoutSeconds * 1000 });
  const parsed = parseTrace(r.stdout);
  const timedOut = r.code !== 0 && r.durationMs >= c.timeoutSeconds * 1000;
  return {
    arm,
    run,
    status: r.code === 0 ? "completed" : timedOut ? "timeout" : "error",
    ...parsed,
    durationMs: r.durationMs,
    workspace,
    error: r.code === 0 ? undefined : r.stderr.slice(-500),
  };
}

function copyDir(from: string, to: string): void {
  for (const n of readdirSync(from)) {
    const src = join(from, n);
    const dst = join(to, n);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyDir(src, dst);
    } else writeFileSync(dst, readFileSync(src));
  }
}

const JUDGE_SYSTEM =
  "You grade one transcript of a coding agent against one criterion. Answer with a first line of exactly PASS or FAIL, then one sentence of reason.";

export async function gradeRun(
  c: EvalCase,
  r: RunResult,
  judge: { model: string; thinking: string; timeoutMs: number; cwd: string },
): Promise<GradedRun> {
  const graders: GradeResult[] = [];
  for (const g of c.graders) {
    const base = { name: g.name, type: g.type };
    if (r.status !== "completed") {
      graders.push({ ...base, passed: false, reason: `run ${r.status}` });
      continue;
    }
    if (g.type === "regex") {
      const text = g.target === "trace" ? traceText(r.trace) : r.lastMessage;
      const hit = new RegExp(g.pattern ?? "", g.flags ?? "").test(text);
      const passed = g.match === "not_contains" ? !hit : hit;
      graders.push({ ...base, passed, reason: `pattern ${hit ? "matched" : "not found"} in ${g.target}` });
    } else if (g.type === "tool_used") {
      const inputRe = g.inputMatch ? new RegExp(g.inputMatch) : undefined;
      const n = r.trace.filter((t) => t.kind === "tool" && t.tool === g.tool && (!inputRe || inputRe.test(t.input ?? ""))).length;
      const passed = n >= (g.min ?? 1) && (g.max === undefined || n <= g.max);
      graders.push({ ...base, passed, reason: `${g.tool} called ${n}x` });
    } else if (g.type === "file_exists") {
      const found = globSync(g.path ?? "", { cwd: r.workspace });
      graders.push({ ...base, passed: found.length > 0, reason: found.length ? `found ${found.slice(0, 3).join(", ")}` : "no match" });
    } else {
      const prompt = [`# Criterion`, g.criteria, "", `# Prompt given to the agent`, c.prompt, "", `# Transcript`, traceText(r.trace)].join("\n");
      const j = await runModel({ ...judge, systemPrompt: JUDGE_SYSTEM, prompt });
      const first = j.stdout.trim().split("\n")[0]?.trim().toUpperCase() ?? "";
      graders.push({
        ...base,
        passed: j.code === 0 && first.startsWith("PASS"),
        reason: j.code === 0 ? j.stdout.trim().split("\n").slice(1).join(" ").slice(0, 200) : `judge failed: ${j.stderr.slice(-120)}`,
      });
    }
  }
  const score = graders.length ? graders.filter((g) => g.passed).length / graders.length : r.status === "completed" ? 1 : 0;
  return { ...r, graders, score };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function runAndGrade(
  c: EvalCase,
  opts: { model: string; thinking: string; judgeModel: string; workRoot: string; log?: (line: string) => void },
): Promise<CaseResult> {
  const arms: Arm[] = c.ablation ? ["with", "without"] : ["with"];
  const out: CaseResult = { name: c.name, createdAt: Date.now(), model: c.model ?? opts.model, arms: {}, score: 0 };
  const judge = { model: opts.judgeModel, thinking: "low", timeoutMs: 120_000, cwd: tmpdir() };
  for (const arm of arms) {
    const runs: GradedRun[] = [];
    for (let i = 1; i <= c.runs; i++) {
      opts.log?.(`${c.name} ${arm} run ${i}/${c.runs}`);
      const r = await runCase(c, arm, i, opts);
      const g = await gradeRun(c, r, judge);
      opts.log?.(`${c.name} ${arm} run ${i}: ${r.status} score=${g.score.toFixed(2)} tools=${r.toolCalls} tokens=${r.tokens}`);
      runs.push(g);
      rmSync(r.workspace, { recursive: true, force: true });
    }
    out.arms[arm] = runs;
  }
  out.score = mean((out.arms.with ?? []).map((r) => r.score));
  if (out.arms.without) out.baselineScore = mean(out.arms.without.map((r) => r.score));
  return out;
}

export function resultsDir(evalDir: string): string {
  return join(evalDir, "results");
}

export function writeResult(evalDir: string, batch: string, r: CaseResult): string {
  const dir = join(resultsDir(evalDir), batch);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.name}.json`);
  writeFileSync(file, JSON.stringify(r, null, 2));
  return file;
}

export function listResults(evalDir: string, opts: { name?: string; since?: number } = {}): CaseResult[] {
  const root = resultsDir(evalDir);
  if (!existsSync(root)) return [];
  const out: CaseResult[] = [];
  for (const batch of readdirSync(root)) {
    const dir = join(root, batch);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      if (opts.name && f !== `${opts.name}.json`) continue;
      try {
        const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as CaseResult;
        if (opts.since !== undefined && r.createdAt <= opts.since) continue;
        out.push(r);
      } catch {
        continue;
      }
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function renderResults(results: CaseResult[]): string {
  const rows = results.map((r) => {
    const w = r.arms.with ?? [];
    const failed = w.flatMap((x) => x.graders.filter((g) => !g.passed).map((g) => g.name));
    const base = r.baselineScore === undefined ? "-" : r.baselineScore.toFixed(2);
    return `| ${r.name} | ${new Date(r.createdAt).toISOString().slice(0, 16)} | ${r.model} | ${r.score.toFixed(2)} | ${base} | ${w.length} | ${mean(w.map((x) => x.toolCalls)).toFixed(1)} | ${Math.round(mean(w.map((x) => x.tokens)))} | ${[...new Set(failed)].join(", ")} |`;
  });
  return ["| case | when | model | score | baseline | runs | tools | tokens | failed graders |", "|---|---|---|---|---|---|---|---|---|", ...rows].join("\n");
}
