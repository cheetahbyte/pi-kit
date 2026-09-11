import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { digestSession } from "./digest.ts";
import { isCorrection } from "./flag.ts";
import { readSessionMetrics } from "./metrics.ts";
import { agentDir, efficiencyDbPath, harnessDir, sessionsDir } from "./paths.ts";
import { listProposals, parseProposals, writeProposal } from "./proposals.ts";
import { listSessionFiles, readUserMessages } from "./sessions.ts";
import { buildSnapshot } from "./snapshot.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 10 * 60 * 1000;
const PI_TIMEOUT_MS = 5 * 60 * 1000;

export interface AuditRow {
  id: string;
  date: string;
  cwd: string;
  corrections: string[];
  metrics?: Record<string, unknown>;
}

export function buildRetroPrompt(input: {
  sessionId: string;
  digest: string;
  snapshot: string;
  metrics?: Record<string, unknown>;
  reasons: string[];
}): string {
  return [
    `Session id: ${input.sessionId}`,
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
    "| session | date | cwd | corrections | toolCalls | toolErrors | failureLoops |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of input.rows) {
    const m = r.metrics ?? {};
    table.push(
      `| ${r.id} | ${r.date} | ${r.cwd} | ${r.corrections.length} | ${m.toolCalls ?? ""} | ${m.toolErrors ?? ""} | ${m.failureLoops ?? ""} |`,
    );
  }
  const quotes = input.rows.flatMap((r) => r.corrections.map((c) => `- ${r.id}: ${c.slice(0, 200)}`));
  return ["# Harness snapshot", input.snapshot, "", "# Sessions", ...table, "", "# Correction messages", ...quotes].join("\n");
}

export function runPi(opts: {
  model: string;
  thinking: string;
  systemPrompt: string;
  prompt: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const args = [
      "-p", "--mode", "text",
      "--no-extensions", "--no-skills", "--no-context-files", "--no-session", "--no-prompt-templates",
      "--thinking", opts.thinking,
      "--model", opts.model,
      "--tools", "read",
      "--system-prompt", opts.systemPrompt,
      opts.prompt,
    ];
    const child = spawn("pi", args, {
      cwd: agentDir(),
      env: { ...process.env, PI_HARNESS_WORKER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: String(e), code: 1 });
    });
  });
}

export function spawnWorker(mode: "retro" | "audit", args: string[]): void {
  const main = join(HERE, "worker-main.ts");
  const child = spawn(process.execPath, [main, mode, ...args], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PI_HARNESS_WORKER: "1" },
  });
  child.unref();
}

function workDir(name: string): string {
  const d = join(harnessDir(), "work", name);
  mkdirSync(d, { recursive: true });
  return d;
}

function log(dir: string, line: string): void {
  appendFileSync(join(dir, "worker.log"), `${new Date().toISOString()} ${line}\n`);
}

function pruneWork(): void {
  const root = join(harnessDir(), "work");
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
  const hd = harnessDir();
  const existingTitles = (["pending", "accepted", "rejected"] as const).flatMap((s) =>
    listProposals(hd, s).map((p) => p.title),
  );
  const proposals = parseProposals(raw, { ...ctx, existingTitles });
  for (const p of proposals) log(dir, `wrote ${writeProposal(hd, p)}`);
  log(dir, `done, ${proposals.length} proposals`);
  return proposals.length;
}

async function runModel(dir: string, promptFile: string, prompt: string, systemPrompt: string): Promise<string | undefined> {
  const cfg = loadConfig(harnessDir());
  writeFileSync(join(dir, "prompt.md"), prompt);
  log(dir, `running ${cfg.model} (${promptFile})`);
  const r = await runPi({ model: cfg.model, thinking: cfg.thinking, systemPrompt, prompt, timeoutMs: PI_TIMEOUT_MS });
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
    const cfg = loadConfig(harnessDir());
    const digest = digestSession(readFileSync(sessionFile, "utf8"), cfg.maxDigestChars);
    writeFileSync(join(dir, "digest.md"), digest);
    let metrics: Record<string, unknown> | undefined;
    for (let i = 0; i < 3 && !metrics; i++) {
      metrics = readSessionMetrics(efficiencyDbPath(), sessionId);
      if (!metrics) await sleep(5000);
    }
    log(dir, `reasons=${reasons.join(",") || "manual"} metrics=${metrics ? "yes" : "no"}`);
    const prompt = buildRetroPrompt({ sessionId, digest, snapshot: buildSnapshot(agentDir(), harnessDir()), metrics, reasons });
    const raw = await runModel(dir, "retro", prompt, readFileSync(join(HERE, "prompts", "retro.md"), "utf8"));
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
    const cfg = loadConfig(harnessDir());
    const files = listSessionFiles(sessionsDir(), { limit: n });
    const rows: AuditRow[] = files.map((f) => ({
      id: f.id.slice(0, 8),
      date: new Date(f.startedAt).toISOString().slice(0, 10),
      cwd: f.cwd,
      corrections: readUserMessages(f.path).filter((t) => isCorrection(t, cfg.correctionPatterns)),
      metrics: readSessionMetrics(efficiencyDbPath(), f.id),
    }));
    log(dir, `audit over ${rows.length} sessions`);
    const prompt = buildAuditPrompt({ rows, snapshot: buildSnapshot(agentDir(), harnessDir()) });
    const raw = await runModel(dir, "audit", prompt, readFileSync(join(HERE, "prompts", "audit.md"), "utf8"));
    return raw === undefined ? 0 : finish(dir, raw, { source: "audit", sessionIds: files.map((f) => f.id) });
  } catch (e) {
    log(dir, `error: ${String(e)}`);
    return 0;
  }
}

export function lastWorkerError(): string | undefined {
  const root = join(harnessDir(), "work");
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .map((n) => join(root, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const logFile = dirs[0] ? join(dirs[0], "worker.log") : undefined;
  if (!logFile || !existsSync(logFile)) return undefined;
  const last = readFileSync(logFile, "utf8").trim().split("\n").at(-1) ?? "";
  return last.includes(" error: ") ? last : undefined;
}
