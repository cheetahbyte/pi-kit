import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cacheVersion = 1;
const skillPath = /\/skills\/([^/]+)\/SKILL\.md$/;

export type Total = { count: number; errors: number; cost: number; input: number; cached: number; output: number };
export type Row = Total & { day: string; kind: "model" | "tool" | "skill"; name: string };
export type FileStats = { mtimeMs: number; size: number; cwd: string; rows: Row[] };
export type Table = Map<string, Total>;
export type Stats = { sessions: number; total: Total; days: Map<string, number>; models: Table; projects: Table; tools: Table; skills: Table };

type SessionLine = {
  type?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    role?: string;
    provider?: string;
    model?: string;
    toolName?: string;
    isError?: boolean;
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
    content?: Array<{ type?: string; name?: string; arguments?: { path?: unknown } }>;
  };
};

const zero = (): Total => ({ count: 0, errors: 0, cost: 0, input: 0, cached: 0, output: 0 });

function add(target: Total, source: Total): void {
  for (const key of Object.keys(zero()) as Array<keyof Total>) target[key] += source[key];
}

export function parseSession(text: string): { cwd: string; rows: Row[] } {
  const rows = new Map<string, Row>();
  const row = (day: string, kind: Row["kind"], name: string): Row => {
    const key = `${day}|${kind}|${name}`;
    if (!rows.has(key)) rows.set(key, { day, kind, name, ...zero() });
    return rows.get(key)!;
  };
  let cwd = "";

  for (const line of text.split("\n")) {
    if (!line.startsWith('{"type":"session"') && !line.includes('"role":"assistant"') && !line.includes('"role":"toolResult"')) continue;
    let entry: SessionLine;
    try {
      entry = JSON.parse(line) as SessionLine;
    } catch {
      continue;
    }
    if (entry.type === "session") cwd = entry.cwd ?? "";
    const { message } = entry;
    const day = String(entry.timestamp).slice(0, 10);
    if (message?.role === "toolResult" && message.isError) row(day, "tool", message.toolName ?? "unknown").errors++;
    if (message?.role !== "assistant") continue;

    const { usage } = message;
    add(row(day, "model", `${message.provider}/${message.model}`), {
      count: 1,
      errors: 0,
      cost: usage?.cost?.total ?? 0,
      input: (usage?.input ?? 0) + (usage?.cacheWrite ?? 0),
      cached: usage?.cacheRead ?? 0,
      output: usage?.output ?? 0,
    });
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type !== "toolCall" || !part.name) continue;
      row(day, "tool", part.name).count++;
      const skill = part.name === "read" && typeof part.arguments?.path === "string" && skillPath.exec(part.arguments.path)?.[1];
      if (skill) row(day, "skill", skill).count++;
    }
  }
  return { cwd, rows: [...rows.values()] };
}

export async function scan(sessionsDirectory: string, cachePath: string): Promise<FileStats[]> {
  let cached: Record<string, FileStats> = {};
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as { version?: number; files?: Record<string, FileStats> };
    if (cache.version === cacheVersion && cache.files) cached = cache.files;
  } catch {}

  const files: Record<string, FileStats> = {};
  let changed = false;
  for (const name of await readdir(sessionsDirectory, { recursive: true }).catch(() => [])) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(sessionsDirectory, name);
    try {
      const { mtimeMs, size } = await stat(path);
      const hit = cached[path];
      if (hit?.mtimeMs === mtimeMs && hit.size === size) files[path] = hit;
      else {
        files[path] = { mtimeMs, size, ...parseSession(await readFile(path, "utf8")) };
        changed = true;
      }
    } catch {}
  }
  if (changed || Object.keys(files).length !== Object.keys(cached).length) {
    await writeFile(cachePath, JSON.stringify({ version: cacheVersion, files })).catch(() => {});
  }
  return Object.values(files);
}

export function aggregate(files: FileStats[], since: string): Stats {
  const stats: Stats = { sessions: 0, total: zero(), days: new Map(), models: new Map(), projects: new Map(), tools: new Map(), skills: new Map() };
  const addTo = (table: Table, name: string, row: Row): void => {
    if (!table.has(name)) table.set(name, zero());
    add(table.get(name)!, row);
  };
  for (const file of files) {
    const rows = file.rows.filter((row) => row.day >= since);
    if (rows.length) stats.sessions++;
    for (const row of rows) {
      if (row.kind !== "model") {
        addTo(row.kind === "tool" ? stats.tools : stats.skills, row.name, row);
        continue;
      }
      add(stats.total, row);
      addTo(stats.models, row.name, row);
      addTo(stats.projects, file.cwd || "unknown", row);
      stats.days.set(row.day, (stats.days.get(row.day) ?? 0) + row.cost);
    }
  }
  return stats;
}
