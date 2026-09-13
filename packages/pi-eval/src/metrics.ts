import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function open(dbPath: string): DatabaseSync | undefined {
  if (!existsSync(dbPath)) return undefined;
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return undefined;
  }
}

export function readSessionMetrics(dbPath: string, sessionId: string): Record<string, unknown> | undefined {
  const db = open(dbPath);
  if (!db) return undefined;
  try {
    const row = db.prepare("SELECT data FROM session_metrics WHERE session_id = ?").get(sessionId) as
      | { data?: string }
      | undefined;
    return row?.data ? (JSON.parse(row.data) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

export function readMetricSeries(
  dbPath: string,
  metric: string,
  opts: { since?: number; before?: number; limit?: number },
): number[] {
  const db = open(dbPath);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        "SELECT m.data AS data FROM session_metrics m JOIN sessions s ON s.id = m.session_id WHERE s.started_at > ? AND s.started_at < ? ORDER BY s.started_at DESC LIMIT ?",
      )
      .all(opts.since ?? 0, opts.before ?? Number.MAX_SAFE_INTEGER, opts.limit ?? 1000) as { data: string }[];
    return rows
      .map((r) => (JSON.parse(r.data) as Record<string, unknown>)[metric])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } catch {
    return [];
  } finally {
    db.close();
  }
}
