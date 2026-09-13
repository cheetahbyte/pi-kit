import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listCases } from "./cases.ts";
import { loadConfig } from "./config.ts";
import { digestSession } from "./digest.ts";
import { isCorrection } from "./flag.ts";
import { readSessionMetrics } from "./metrics.ts";
import { agentDir, efficiencyDbPath, evalDir, sessionsDir } from "./paths.ts";
import { runModel } from "./pi.ts";
import { listProposals, parseProposals, writeProposal } from "./proposals.ts";
import { runAndGrade, writeResult } from "./runner.ts";
import { listSessionFiles, readUserMessages } from "./sessions.ts";
import { buildSnapshot } from "./snapshot.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 10 * 60 * 1000;
const PI_TIMEOUT_MS = 5 * 60 * 1000;

export type WorkerMode = "retro" | "audit" | "run";

export interface AuditRow {
  id: string;
  date: string;
  cwd: string;
  model: string;
  corrections: string[];
  metrics?: Record<string, unknown>;
}

export function buildRetroPrompt(input: {
  sessionId: string;
  digest: string;
  snapshot: string;
  metrics?: Record<string, unknown>;
  reasons: string[];
  model?: string;
}): string {
  return [
    `Session id: ${input.sessionId}`,
    `Session model: ${input.model ?? "unknown"}`,
    `Flag reasons: ${input.reasons.join(", ") || "manual"}`,
    "",
    "# Harness snapshot",
    input.snapshot,
    "",
    "# Session metrics",
    "```json",
    JSON.stringify(input.metrics ?? {}, null, 2),
    "```",
    "",
    "# Transcript digest",
    input.digest,
  ].join("\n");
}

export function buildAuditPrompt(input: { rows: AuditRow[]; snapshot: string }): string {
  const table = [
    "| session | date | cwd | model | corrections | toolCalls | toolErrors | failureLoops |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of input.rows) {
    const m = r.metrics ?? {};
    table.push(
      `| ${r.id} | ${r.date} | ${r.cwd} | ${r.model} | ${r.corrections.length} | ${m.toolCalls ?? ""} | ${m.toolErrors ?? ""} | ${m.failureLoops ?? ""} |`,
    );
  }
  const quotes = input.rows.flatMap((r) => r.corrections.map((c) => `- ${r.id}: ${c.slice(0, 200)}`));
  return ["# Harness snapshot", input.snapshot, "", "# Sessions", ...table, "", "# Correction messages", ...quotes].join("\n");
}

export function spawnWorker(mode: WorkerMode, args: string[]): void {
  const main = join(HERE, "worker-main.ts");
  const child = spawn(process.execPath, [main, mode, ...args], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PI_EVAL_WORKER: "1" },
  });
  child.unref();
}

function workDir(name: string): string {
  const d = join(evalDir(), "work", name);
  mkdirSync(d, { recursive: true });
  return d;
}

function log(dir: string, line: string): void {
  appendFileSync(join(dir, "worker.log"), `${new Date().toISOString()} ${line}\n`);
}

function pruneWork(): void {
  const root = join(evalDir(), "work");
  if (!existsSync(root)) return;
  for (const n of readdirSync(root)) {
    const d = join(root, n);
    if (Date.now() - statSync(d).mtimeMs > WORK_TTL_MS) rmSync(d, { recursive: true, force: true });
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function finish(dir: string, raw: string, ctx: { source: "retro" | "audit"; sessionIds: string[] }): number {
  const hd = evalDir();
  const existingTitles = (["pending", "accepted", "rejected"] as const).flatMap((s) =>
    listProposals(hd, s).map((p) => p.title),
  );
  const proposals = parseProposals(raw, { ...ctx, existingTitles });
  for (const p of proposals) log(dir, `wrote ${writeProposal(hd, p)}`);
  log(dir, `done, ${proposals.length} proposals`);
  return proposals.length;
}

async function askModel(dir: string, promptFile: string, prompt: string, systemPrompt: string): Promise<string | undefined> {
  const cfg = loadConfig(evalDir());
  writeFileSync(join(dir, "prompt.md"), prompt);
  log(dir, `running ${cfg.model} (${promptFile})`);
  const r = await runModel({ model: cfg.model, thinking: cfg.thinking, systemPrompt, prompt, cwd: agentDir(), timeoutMs: PI_TIMEOUT_MS });
  writeFileSync(join(dir, "raw.txt"), r.stdout);
  if (r.code !== 0) {
    log(dir, `error: pi exited ${r.code}: ${r.stderr.slice(-500).replace(/\n/g, " ")}`);
    return undefined;
  }
  return r.stdout;
}

export async function runRetro(sessionFile: string, sessionId: string, reasons: string[]): Promise<number> {
  const dir = workDir(sessionId);
  const lock = join(dir, ".lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < LOCK_TTL_MS) return 0;
  writeFileSync(lock, String(process.pid));
  try {
    pruneWork();
    const cfg = loadConfig(evalDir());
    const digest = digestSession(readFileSync(sessionFile, "utf8"), cfg.maxDigestChars);
    writeFileSync(join(dir, "digest.md"), digest);
    let metrics: Record<string, unknown> | undefined;
    for (let i = 0; i < 3 && !metrics; i++) {
      metrics = readSessionMetrics(efficiencyDbPath(), sessionId);
      if (!metrics) await sleep(5000);
    }
    const header = listSessionFiles(sessionsDir()).find((s) => s.id === sessionId);
    log(dir, `reasons=${reasons.join(",") || "manual"} metrics=${metrics ? "yes" : "no"}`);
    const prompt = buildRetroPrompt({
      sessionId,
      digest,
      snapshot: buildSnapshot(agentDir(), evalDir(), { cwd: header?.cwd }),
      metrics,
      reasons,
      model: header?.model,
    });
    const raw = await askModel(dir, "retro", prompt, readFileSync(join(HERE, "prompts", "retro.md"), "utf8"));
    return raw === undefined ? 0 : finish(dir, raw, { source: "retro", sessionIds: [sessionId] });
  } catch (e) {
    log(dir, `error: ${String(e)}`);
    return 0;
  } finally {
    rmSync(lock, { force: true });
  }
}

export async function runAudit(n: number): Promise<number> {
  const dir = workDir(`audit-${new Date().toISOString().slice(0, 10)}`);
  try {
    const cfg = loadConfig(evalDir());
    const files = listSessionFiles(sessionsDir(), { limit: n });
    const rows: AuditRow[] = files.map((f) => ({
      id: f.id.slice(0, 8),
      date: new Date(f.startedAt).toISOString().slice(0, 10),
      cwd: f.cwd,
      model: f.model ?? "",
      corrections: readUserMessages(f.path).filter((t) => isCorrection(t, cfg.correctionPatterns)),
      metrics: readSessionMetrics(efficiencyDbPath(), f.id),
    }));
    log(dir, `audit over ${rows.length} sessions`);
    const prompt = buildAuditPrompt({ rows, snapshot: buildSnapshot(agentDir(), evalDir()) });
    const raw = await askModel(dir, "audit", prompt, readFileSync(join(HERE, "prompts", "audit.md"), "utf8"));
    return raw === undefined ? 0 : finish(dir, raw, { source: "audit", sessionIds: files.map((f) => f.id) });
  } catch (e) {
    log(dir, `error: ${String(e)}`);
    return 0;
  }
}

export async function runEvals(filter: string | undefined): Promise<number> {
  const batch = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = workDir(`run-${batch}`);
  try {
    pruneWork();
    const cfg = loadConfig(evalDir());
    const cases = listCases(evalDir(), filter);
    log(dir, `running ${cases.length} case(s)${filter ? ` matching ${filter}` : ""}`);
    let settings: { defaultModel?: string; defaultProvider?: string; defaultThinkingLevel?: string } = {};
    try {
      settings = JSON.parse(readFileSync(join(agentDir(), "settings.json"), "utf8"));
    } catch {
      settings = {};
    }
    const model =
      cfg.evalModel ??
      (settings.defaultModel ? `${settings.defaultProvider ? `${settings.defaultProvider}/` : ""}${settings.defaultModel}` : cfg.model);
    let n = 0;
    for (const c of cases) {
      const r = await runAndGrade(c, {
        model,
        thinking: settings.defaultThinkingLevel ?? "low",
        judgeModel: cfg.judgeModel ?? cfg.model,
        workRoot: join(dir, "ws"),
        log: (l) => log(dir, l),
      });
      log(dir, `wrote ${writeResult(evalDir(), batch, r)}`);
      n += 1;
    }
    log(dir, `done, ${n} case(s)`);
    return n;
  } catch (e) {
    log(dir, `error: ${String(e)}`);
    return 0;
  }
}

export function lastWorkerError(): string | undefined {
  const root = join(evalDir(), "work");
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .map((n) => join(root, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const logFile = dirs[0] ? join(dirs[0], "worker.log") : undefined;
  if (!logFile || !existsSync(logFile)) return undefined;
  const last = readFileSync(logFile, "utf8").trim().split("\n").at(-1) ?? "";
  return last.includes(" error: ") ? last : undefined;
}
