import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { EventKind } from "./types.js";

export interface ClassificationConfig {
  tools: Partial<Record<EventKind, string[]>>;
  validationPatterns: string[];
  correctionPatterns: string[];
}

export const DEFAULT_CONFIG: ClassificationConfig = {
  tools: {
    search: ["grep", "find", "symbol_search", "ast_grep_search", "duckduckgo_search"],
    read: ["read", "duckduckgo_fetch_content", "get_subagent_result"],
    semantic_navigation: ["lsp_navigation", "module_report", "project_report", "read_symbol", "read_enclosing"],
    edit: ["edit", "ast_grep_replace"],
    write: ["write"],
    subagent: ["Agent", "steer_subagent", "herdr_start_agent", "herdr_delegate", "herdr_send_prompt"],
  },
  validationPatterns: [
    "(?:^|&&|;|\\s)(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:test|typecheck|lint|check|build)(?:\\s|$)",
    "(?:^|&&|;|\\s)(?:go test|cargo test|cargo check|pytest|swift build|swift test|tsc|eslint|biome check)(?:\\s|$)",
  ],
  correctionPatterns: [
    "^\\s*(?:no|wrong)[,.!\\s]", "that's not what i meant", "\\b(?:revert|undo)\\b",
    "you changed .+ but i asked",
  ],
};

export function mergeConfig(input?: Partial<ClassificationConfig>): ClassificationConfig {
  const validPatterns = (value: unknown, fallback: string[]): string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.length <= 200 && safeRegex(item))
      ? value
      : fallback;
  const tools = input?.tools && typeof input.tools === "object"
    ? Object.fromEntries(Object.entries(input.tools).filter(([, names]) => Array.isArray(names) && names.every((name) => typeof name === "string")))
    : {};
  return {
    tools: { ...DEFAULT_CONFIG.tools, ...tools },
    validationPatterns: validPatterns(input?.validationPatterns, DEFAULT_CONFIG.validationPatterns),
    correctionPatterns: validPatterns(input?.correctionPatterns, DEFAULT_CONFIG.correctionPatterns),
  };
}

export function classifyTool(name: string, input: Record<string, unknown>, config: ClassificationConfig): EventKind {
  for (const [kind, names] of Object.entries(config.tools)) {
    if (names?.includes(name)) return kind as EventKind;
  }
  if (name === "bash") {
    const command = String(input.command ?? "");
    return config.validationPatterns.some((pattern) => new RegExp(pattern, "i").test(command)) ? "validation" : "bash";
  }
  return "bash";
}

export function normalizedToolMetadata(
  kind: EventKind,
  input: Record<string, unknown>,
  cwd: string,
): { target?: string; range?: string; fingerprint: string; metadata: Record<string, unknown> } {
  const path = typeof input.path === "string" ? resolve(cwd, input.path.replace(/^@/, "")) : undefined;
  const offset = number(input.offset);
  const limit = number(input.limit);
  const range = path && (offset !== undefined || limit !== undefined) ? `${offset ?? 1}:${limit ?? "end"}` : path ? "all" : undefined;
  const query = String(input.query ?? input.pattern ?? input.command ?? "").trim().replace(/\s+/g, " ");
  const editShape = kind === "edit" || kind === "write" ? stable({ edits: input.edits, oldText: input.oldText, newText: input.newText, content: input.content }) : undefined;
  const basis = stable({ kind, path, range, query: redact(query), editShape });
  return {
    target: path,
    range,
    fingerprint: hash(basis),
    metadata: query ? { queryHash: hash(redact(query)) } : {},
  };
}

export function isCorrection(text: string, config: ClassificationConfig): boolean {
  return config.correctionPatterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stable(value: unknown): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

function safeRegex(value: string): boolean {
  try {
    // Reject the common catastrophic nested-quantifier shape in project config.
    if (/[+*}]\)?[+*{]/.test(value)) return false;
    new RegExp(value, "i");
    return true;
  } catch {
    return false;
  }
}

function redact(value: string): string {
  return value
    .replace(/(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s]+/gi, "$1=<redacted>")
    .replace(/authorization:\s*bearer\s+\S+/gi, "authorization: Bearer <redacted>")
    .replace(/\b(?:sk[-_][A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|xox[baprs]-\S+)\b/g, "<redacted>");
}
