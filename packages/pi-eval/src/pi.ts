import { spawn } from "node:child_process";

export interface PiRun {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
}

export function runPi(opts: {
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}): Promise<PiRun> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("pi", ["-p", ...opts.args, opts.prompt], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, PI_EVAL_WORKER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    const done = (code: number, err?: string): void => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err ?? stderr, code, durationMs: Date.now() - started });
    };
    child.on("close", (code) => done(code ?? 1));
    child.on("error", (e) => done(1, String(e)));
  });
}

// Bare model call: no harness at all, used for retro/audit/judge prompts.
export function runModel(opts: {
  model: string;
  thinking: string;
  systemPrompt: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
}): Promise<PiRun> {
  return runPi({
    args: [
      "--mode", "text",
      "--no-extensions", "--no-skills", "--no-context-files", "--no-session", "--no-prompt-templates",
      "--thinking", opts.thinking,
      "--model", opts.model,
      "--tools", "read",
      "--system-prompt", opts.systemPrompt,
    ],
    prompt: opts.prompt,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
  });
}
