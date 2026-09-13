import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { userTextOf } from "./digest.ts";

export interface SessionFile {
  path: string;
  id: string;
  startedAt: number;
  cwd: string;
  model?: string;
}

function headerOf(path: string): SessionFile | undefined {
  try {
    const lines = readFileSync(path, "utf8").split("\n", 6);
    const h = JSON.parse(lines[0] ?? "") as { type?: string; id?: string; timestamp?: string; cwd?: string };
    if (h.type !== "session" || !h.id || !h.timestamp) return undefined;
    let model: string | undefined;
    for (const l of lines.slice(1)) {
      try {
        const e = JSON.parse(l) as { type?: string; provider?: string; modelId?: string };
        if (e.type === "model_change" && e.modelId) {
          model = e.provider ? `${e.provider}/${e.modelId}` : e.modelId;
          break;
        }
      } catch {
        continue;
      }
    }
    return { path, id: h.id, startedAt: Date.parse(h.timestamp), cwd: h.cwd ?? "", model };
  } catch {
    return undefined;
  }
}

export function listSessionFiles(
  sessionsDir: string,
  opts: { since?: number; before?: number; limit?: number } = {},
): SessionFile[] {
  if (!existsSync(sessionsDir)) return [];
  const out: SessionFile[] = [];
  for (const slug of readdirSync(sessionsDir)) {
    const dir = join(sessionsDir, slug);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const s = headerOf(join(dir, f));
      if (!s) continue;
      if (opts.since !== undefined && s.startedAt <= opts.since) continue;
      if (opts.before !== undefined && s.startedAt >= opts.before) continue;
      out.push(s);
    }
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export function readUserMessages(path: string): string[] {
  const out: string[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try {
      const e = JSON.parse(raw) as { type?: string; message?: unknown };
      if (e.type !== "message") continue;
      const t = userTextOf(e.message);
      if (t !== undefined) out.push(t);
    } catch {
      continue;
    }
  }
  return out;
}
