import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, relative, resolve } from "node:path";

export const hookEvents = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "PreCompact", "PostCompact", "SessionEnd"] as const;
export type HookEvent = (typeof hookEvents)[number];
export type Handler = { type?: string; command?: string; args?: string[]; timeout?: number; if?: string };
export type Group = { matcher?: string; hooks?: Handler[] };
export type Config = Partial<Record<HookEvent, Group[]>>;
export type Output = { stdout: string; stderr: string; code: number | null };
export type Outcome = { context: string[]; notices: string[]; block?: string; ask?: string; stop?: string; updatedInput?: Record<string, unknown> };

type HookOutput = {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  decision?: string;
  reason?: string;
  hookSpecificOutput?: { additionalContext?: string; permissionDecision?: string; permissionDecisionReason?: string; updatedInput?: Record<string, unknown> };
};

const maxContextLength = 10_000;
const plainTextEvents = new Set<HookEvent>(["SessionStart", "UserPromptSubmit"]);
const legacyDecisions: Record<string, string> = { block: "deny", approve: "allow" };
const claudeTools: Record<string, string> = { bash: "Bash", read: "Read", write: "Write", edit: "Edit", grep: "Grep", find: "Glob" };
const fileTools = new Set(["read", "write", "edit"]);

// Later files add hooks to earlier ones. For disableAllHooks, the last file that sets it wins.
export function loadConfig(paths: string[]): Config {
  const config: Config = {};
  let disabled = false;
  for (const path of paths) {
    let settings: { hooks?: Config; disableAllHooks?: unknown } | null;
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[pi-hooks] ${path}: ${error}`);
      continue;
    }
    if (typeof settings?.disableAllHooks === "boolean") disabled = settings.disableAllHooks;
    for (const event of hookEvents) {
      const groups = settings?.hooks?.[event];
      if (Array.isArray(groups)) (config[event] ??= []).push(...groups);
    }
  }
  return disabled ? {} : config;
}

export function matches(matcher: string | undefined, value: string): boolean {
  if (!matcher || matcher === "*") return true;
  if (/^[\w\- ,|]+$/.test(matcher)) return matcher.split(/[|,]/).some((name) => name.trim() === value);
  try {
    return new RegExp(matcher).test(value);
  } catch {
    return false;
  }
}

function glob(pattern: string, star: string): RegExp {
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\0")
    .replace(/\*/g, star)
    .replace(/\0/g, ".*");
  return new RegExp(`^${source}$`);
}

// Best effort, like Claude Code: when the rule can't be evaluated, the hook runs.
export function matchesIf(rule: string, toolName: string, input: Record<string, unknown>, cwd: string): boolean {
  const [, tool, pattern] = /^([^(]+)(?:\((.*)\))?$/s.exec(rule) ?? [];
  if (tool !== toolName) return false;
  if (pattern === undefined) return true;
  if (typeof input.command === "string") {
    if (/\$\(|`/.test(input.command)) return true;
    const test = glob(pattern, ".*");
    return input.command.split(/&&|\|\||[;|\n]/).some((part) => test.test(part.trim().replace(/^(\w+=\S*\s+)+/, "")));
  }
  if (typeof input.file_path === "string") return glob(pattern, "[^/]*").test(pattern.includes("/") ? relative(cwd, input.file_path) : basename(input.file_path));
  return true;
}

export const toClaudeTool = (toolName: string): string => claudeTools[toolName] ?? toolName;

// Hooks written for Claude Code read file_path, old_string, and new_string. Pi's own fields stay in place.
export function toClaudeInput(toolName: string, input: Record<string, unknown>, cwd: string): Record<string, unknown> {
  if (!fileTools.has(toolName) || typeof input.path !== "string") return input;
  const claudeInput: Record<string, unknown> = { ...input, file_path: resolve(cwd, input.path.replace(/^~(?=\/|$)/, homedir())) };
  const first = Array.isArray(input.edits) ? (input.edits[0] as { oldText?: unknown; newText?: unknown } | undefined) : undefined;
  if (toolName === "edit" && first) Object.assign(claudeInput, { old_string: first.oldText, new_string: first.newText });
  return claudeInput;
}

export function fromClaudeInput(toolName: string, updated: Record<string, unknown>): Record<string, unknown> {
  if (!fileTools.has(toolName)) return updated;
  const { file_path, old_string, new_string, ...input } = updated;
  if (file_path !== undefined) input.path = file_path;
  if (toolName === "edit" && old_string !== undefined && Array.isArray(input.edits)) input.edits = [{ oldText: old_string, newText: new_string }, ...input.edits.slice(1)];
  return input;
}

const cap = (text: string): string =>
  text.length > maxContextLength ? `${text.slice(0, maxContextLength)}\n[Hook output truncated at ${maxContextLength} characters]` : text;

export function interpret(event: HookEvent, { stdout, stderr, code }: Output): Outcome {
  const outcome: Outcome = { context: [], notices: [] };
  if (code === null) return outcome;

  let output: HookOutput = {};
  let parsed = false;
  if (stdout.startsWith("{") && stdout.endsWith("}")) {
    try {
      output = JSON.parse(stdout);
      parsed = true;
    } catch {
      outcome.notices.push(`${event} hook printed invalid JSON`);
    }
  } else if (code === 0 && stdout && plainTextEvents.has(event)) outcome.context.push(cap(stdout));
  if (!parsed && code !== 0 && code !== 2) outcome.notices.push(`${event} hook failed with status ${code}: ${stderr.split("\n")[0]}`);

  const specific = output.hookSpecificOutput ?? {};
  const legacy = output.decision === undefined ? undefined : legacyDecisions[output.decision];
  const decision = event === "PreToolUse" ? (specific.permissionDecision ?? legacy) : output.decision === "block" ? "deny" : undefined;
  const reason = specific.permissionDecisionReason ?? output.reason;
  if (decision === "deny") outcome.block = reason || stderr || "Blocked by hook";
  else if (code === 2) outcome.block = stderr || "Blocked by hook";
  else if (decision === "ask") outcome.ask = reason || "A hook asks you to confirm this tool call";

  if (typeof specific.additionalContext === "string" && specific.additionalContext) outcome.context.push(cap(specific.additionalContext));
  if (specific.updatedInput && typeof specific.updatedInput === "object") outcome.updatedInput = specific.updatedInput;
  if (output.continue === false) outcome.stop = output.stopReason || "Stopped by hook";
  if (typeof output.systemMessage === "string" && output.systemMessage) outcome.notices.push(output.systemMessage);
  return outcome;
}

// A code of null means the hook timed out, was aborted, or could not start. It then makes no decision.
export function run({ command = "", args }: Handler, cwd: string, input: string, timeoutSeconds: number, signal?: AbortSignal): Promise<Output> {
  return new Promise((done) => {
    const expand = (text: string): string => text.replaceAll("${CLAUDE_PROJECT_DIR}", cwd);
    const options = { cwd, signal, timeout: timeoutSeconds * 1000, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } };
    const child = args ? spawn(expand(command), args.map(expand), options) : spawn(command, { ...options, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", () => done({ stdout: "", stderr: "", code: null }));
    child.on("close", (code) => done({ stdout: stdout.trim(), stderr: stderr.trim(), code }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
