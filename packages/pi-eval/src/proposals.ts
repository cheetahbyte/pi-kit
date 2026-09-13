import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

export type ProposalKind = "agents-rule" | "skill-edit" | "skill-new" | "prompt-edit" | "setting" | "extension-issue" | "prune" | "eval-case";
export type SettingKey = "defaultModel" | "defaultThinkingLevel";

export type Change =
  | { type: "replace"; path: string; search: string; replace: string }
  | { type: "create"; path: string; content: string }
  | { type: "delete-block"; path: string; search: string }
  | { type: "setting"; key: SettingKey; value: string }
  | { type: "note"; text: string };

export type Verify =
  | { kind: "correction"; pattern: string }
  | { kind: "metric"; metric: string; direction: "down" | "up"; baseline: number }
  | { kind: "eval"; case: string; baseline?: number };

export type Outcome = "improved" | "unchanged" | "worse" | "insufficient-data";
export type Status = "pending" | "accepted" | "rejected";

export interface Proposal {
  id: string;
  createdAt: number;
  source: "retro" | "audit";
  sessionIds: string[];
  kind: ProposalKind;
  title: string;
  rationale: string;
  evidence: { sessionId: string; quote: string }[];
  change: Change;
  verify?: Verify;
  supersedes?: string;
  status: Status;
  appliedAt?: number;
  outcome?: Outcome;
}

const KINDS = new Set<string>(["agents-rule", "skill-edit", "skill-new", "prompt-edit", "setting", "extension-issue", "prune", "eval-case"]);
const SETTING_KEYS = new Set<string>(["defaultModel", "defaultThinkingLevel"]);
const MAX_PROPOSALS = 5;

export function allowedPath(path: string): boolean {
  if (typeof path !== "string" || !path || path.includes("\0")) return false;
  const n = normalize(path).replaceAll("\\", "/");
  if (n.startsWith("/") || n.startsWith("..") || n.includes("/../")) return false;
  return n === "AGENTS.md" || n.startsWith("skills/") || n.startsWith("prompts/") || n.startsWith("eval/cases/");
}

function validChange(c: unknown): Change | undefined {
  if (!c || typeof c !== "object") return undefined;
  const o = c as Record<string, unknown>;
  const s = (k: string): string | undefined => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  const path = s("path") ?? "";
  switch (o.type) {
    case "replace": {
      const search = s("search");
      const replace = s("replace");
      return allowedPath(path) && search && replace !== undefined ? { type: "replace", path, search, replace } : undefined;
    }
    case "create": {
      const content = s("content");
      return allowedPath(path) && content !== undefined ? { type: "create", path, content } : undefined;
    }
    case "delete-block": {
      const search = s("search");
      return allowedPath(path) && search ? { type: "delete-block", path, search } : undefined;
    }
    case "setting": {
      const key = s("key");
      const value = s("value");
      return key && SETTING_KEYS.has(key) && value ? { type: "setting", key: key as SettingKey, value } : undefined;
    }
    case "note": {
      const text = s("text");
      return text ? { type: "note", text } : undefined;
    }
    default:
      return undefined;
  }
}

function validVerify(v: unknown): Verify | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o.kind === "correction" && typeof o.pattern === "string" && o.pattern) {
    try {
      new RegExp(o.pattern, "i");
      return { kind: "correction", pattern: o.pattern };
    } catch {
      return undefined;
    }
  }
  if (
    o.kind === "metric" &&
    typeof o.metric === "string" &&
    (o.direction === "down" || o.direction === "up") &&
    typeof o.baseline === "number"
  ) {
    return { kind: "metric", metric: o.metric, direction: o.direction, baseline: o.baseline };
  }
  if (o.kind === "eval" && typeof o.case === "string" && /^[\w.-]+$/.test(o.case)) {
    return { kind: "eval", case: o.case, baseline: typeof o.baseline === "number" ? o.baseline : undefined };
  }
  return undefined;
}

export function proposalId(title: string, now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const h = createHash("sha256").update(title.toLowerCase()).digest("hex").slice(0, 6);
  return `${day}-${h}`;
}

function extractJson(raw: string): unknown[] | undefined {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function parseProposals(
  raw: string,
  ctx: { source: "retro" | "audit"; sessionIds: string[]; existingTitles: string[] },
): Proposal[] {
  const items = extractJson(raw) ?? [];
  const seen = new Set(ctx.existingTitles.map((t) => t.toLowerCase()));
  const out: Proposal[] = [];
  const now = new Date();
  for (const item of items) {
    if (out.length >= MAX_PROPOSALS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (!KINDS.has(String(o.kind)) || typeof o.title !== "string" || !o.title.trim()) continue;
    const title = o.title.trim();
    if (seen.has(title.toLowerCase())) continue;
    const change = validChange(o.change);
    if (!change) continue;
    if (change.type === "setting" && o.kind !== "setting") continue;
    const evidence = Array.isArray(o.evidence)
      ? o.evidence
          .filter((e) => e && typeof e === "object" && typeof (e as { quote?: unknown }).quote === "string")
          .map((e) => ({
            sessionId: String((e as { sessionId?: unknown }).sessionId ?? ctx.sessionIds[0] ?? ""),
            quote: (e as { quote: string }).quote,
          }))
      : [];
    seen.add(title.toLowerCase());
    out.push({
      id: proposalId(title, now),
      createdAt: now.getTime(),
      source: ctx.source,
      sessionIds: ctx.sessionIds,
      kind: o.kind as ProposalKind,
      title,
      rationale: typeof o.rationale === "string" ? o.rationale : "",
      evidence,
      change,
      verify: validVerify(o.verify),
      supersedes: typeof o.supersedes === "string" ? o.supersedes : undefined,
      status: "pending",
    });
  }
  return out;
}

const DIRS: Record<Status, string> = { pending: "proposals", accepted: "applied", rejected: "rejected" };

function dirFor(evalDir: string, status: Status): string {
  const d = join(evalDir, DIRS[status]);
  mkdirSync(d, { recursive: true });
  return d;
}

export function listProposals(evalDir: string, status: Status): Proposal[] {
  const d = dirFor(evalDir, status);
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(d, f), "utf8")) as Proposal];
      } catch {
        return [];
      }
    });
}

export function readProposal(evalDir: string, status: Status, id: string): Proposal | undefined {
  const file = join(dirFor(evalDir, status), `${id}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Proposal;
}

export function writeProposal(evalDir: string, p: Proposal): string {
  const file = join(dirFor(evalDir, p.status), `${p.id}.json`);
  writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
  return file;
}

export function moveProposal(evalDir: string, p: Proposal, to: "accepted" | "rejected"): void {
  const from = join(dirFor(evalDir, p.status), `${p.id}.json`);
  const next: Proposal = { ...p, status: to, appliedAt: to === "accepted" ? Date.now() : undefined };
  writeProposal(evalDir, next);
  if (p.status !== to && existsSync(from)) unlinkSync(from);
}

export function applyChange(agentDir: string, change: Change): { ok: true; path: string } | { ok: false; error: string } {
  if (change.type === "note") return { ok: true, path: "" };
  if (change.type === "setting") {
    const file = join(agentDir, "settings.json");
    let json: Record<string, unknown> = {};
    try {
      json = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    } catch {
      return { ok: false, error: "settings.json is not valid JSON" };
    }
    json[change.key] = change.value;
    writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    return { ok: true, path: file };
  }
  if (!allowedPath(change.path)) return { ok: false, error: `path not allowed: ${change.path}` };
  const file = join(agentDir, change.path);
  if (change.type === "create") {
    if (existsSync(file)) return { ok: false, error: `already exists: ${change.path}` };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, change.content);
    return { ok: true, path: file };
  }
  if (!existsSync(file)) return { ok: false, error: `missing: ${change.path}` };
  const text = readFileSync(file, "utf8");
  const count = matchCount(text, change.search);
  if (count !== 1) return { ok: false, error: `search text found ${count} times in ${change.path}, need exactly 1` };
  const next = text.replace(searchRegex(change.search), () => (change.type === "replace" ? change.replace : ""));
  writeFileSync(file, next);
  return { ok: true, path: file };
}

// Models re-wrap lines; any whitespace run matches any other so wrapped search text still applies.
export function searchRegex(search: string): RegExp {
  const escaped = search
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(search.endsWith("\n") ? `${escaped}\\n?` : escaped, "g");
}

export function matchCount(text: string, search: string): number {
  return text.match(searchRegex(search))?.length ?? 0;
}

export function renderChange(agentDir: string, change: Change): string {
  switch (change.type) {
    case "note":
      return `Note (no file change):\n\n${change.text}`;
    case "setting":
      return `settings.json: ${change.key} = ${change.value}`;
    case "create":
      return `Create ${change.path}:\n\n\`\`\`\n${change.content}\n\`\`\``;
    case "delete-block":
      return `Delete from ${change.path}:\n\n\`\`\`diff\n${change.search
        .split("\n")
        .map((l) => "- " + l)
        .join("\n")}\n\`\`\``;
    case "replace": {
      const file = join(agentDir, change.path);
      const present = existsSync(file) && matchCount(readFileSync(file, "utf8"), change.search) === 1;
      const diff = [
        ...change.search.split("\n").map((l) => "- " + l),
        ...change.replace.split("\n").map((l) => "+ " + l),
      ].join("\n");
      const warn = present ? "" : " (search text NOT found exactly once, apply will fail)";
      return `Edit ${change.path}${warn}:\n\n\`\`\`diff\n${diff}\n\`\`\``;
    }
  }
}
