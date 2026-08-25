import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionMetrics, SessionRecord, WorkflowEvent } from "./types.js";

// Single compact JSON blob per row (`data`) keeps schema small and mapping
// trivial; indexed columns exist only for the queries we actually run.
// No source/output bodies are ever stored — events carry metadata only.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_tags ON sessions(tags);

CREATE TABLE IF NOT EXISTS workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT,
  is_error INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON workflow_events(session_id, at);
CREATE INDEX IF NOT EXISTS idx_events_at ON workflow_events(at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON workflow_events(kind);

CREATE TABLE IF NOT EXISTS session_metrics (
  session_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correction_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_session ON correction_candidates(session_id);
`;

const MEDIAN_KEYS = [
  "toolCalls",
  "toolCallsBeforeFirstEdit",
  "readsBeforeFirstEdit",
  "searchesBeforeFirstEdit",
  "semanticNavigationBeforeFirstEdit",
  "editOperationsBeforeFirstValidation",
  "timeToFirstEditMs",
  "timeFirstEditToFirstValidationMs",
  "sessionDurationMs",
  "filesModified",
  "editOperations",
  "validationRuns",
  "validationFailures",
  "validationSuccesses",
  "toolErrors",
  "repeatedIdenticalErrors",
  "failureLoops",
  "totalFileReads",
  "uniqueFilesRead",
  "uniqueSearches",
  "subagentCalls",
  "compactions",
  "messages",
  "modelTurns",
] as const;

const RATE_KEYS = [
  "toolErrorRate",
  "fileReadRedundancyRatio",
  "searchRedundancyRatio",
  "editsPerModifiedFile",
] as const;

// Latency-ish fields where p90 is more useful than the median.
const P90_KEYS = [
  "timeToFirstEditMs",
  "sessionDurationMs",
  "timeFirstEditToFirstValidationMs",
  "subagentDurationMs",
] as const;

export interface AggregateReport {
  since: number;
  sessions: number;
  events: number;
  sessionOutcomes: Record<string, number>;
  eventKindCounts: Record<string, number>;
  topFailingTools: { tool: string; errors: number }[];
  medians: Record<string, number | null>;
  p90: Record<string, number | null>;
  rates: Record<string, number | null>;
}

export interface CohortComparison {
  tag: string;
  count: number;
  medians: Record<string, number | null>;
}

export interface CorrectionCandidate {
  sessionId: string;
  kind: "validation" | "edit" | "correction";
  at: number;
  detail: Record<string, unknown>;
}

function sortedNums(values: (number | null | undefined)[]): number[] {
  return values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
}

function median(values: (number | null | undefined)[]): number | null {
  const v = sortedNums(values);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function p90(values: (number | null | undefined)[]): number | null {
  const v = sortedNums(values);
  if (v.length === 0) return null;
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.9))];
}

export class EfficiencyRepository {
  private db: DatabaseSync;

  constructor(private readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath);
    chmodSync(dbPath, 0o600);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.protectFiles();
    this.db.exec(SCHEMA);
    // ponytail: single version stamp; stack real migrations here when schema grows.
    this.db.exec("PRAGMA user_version = 1;");
  }

  upsertSession(session: SessionRecord): void {
    const tags = JSON.stringify(session.tags);
    this.db
      .prepare(
        `INSERT INTO sessions (id, started_at, ended_at, outcome, tags, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           outcome = excluded.outcome,
           tags = excluded.tags,
           data = excluded.data`,
      )
      .run(
        session.id,
        session.startedAt,
        session.endedAt ?? null,
        session.outcome,
        tags,
        JSON.stringify(session),
      );
  }

  appendEvents(events: WorkflowEvent[]): void {
    if (events.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO workflow_events (session_id, at, kind, tool_name, is_error, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec("BEGIN");
    try {
      for (const e of events) {
        const { sessionId, at, kind, toolName, isError, ...rest } = e;
        insert.run(
          sessionId,
          at,
          kind,
          toolName ?? null,
          isError ? 1 : 0,
          JSON.stringify(rest),
        );
      }
      this.db.exec("COMMIT");
      this.protectFiles();
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  replaceMetrics(metrics: SessionMetrics): void {
    this.db
      .prepare(
        `INSERT INTO session_metrics (session_id, data) VALUES (?, ?)
         ON CONFLICT(session_id) DO UPDATE SET data = excluded.data`,
      )
      .run(metrics.sessionId, JSON.stringify(metrics));
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare("SELECT data FROM sessions WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as SessionRecord) : null;
  }

  getEvents(sessionId: string): WorkflowEvent[] {
    const rows = this.db
      .prepare("SELECT id, at, kind, tool_name, is_error, data FROM workflow_events WHERE session_id = ? ORDER BY at, id")
      .all(sessionId) as { id: number; at: number; kind: WorkflowEvent["kind"]; tool_name: string | null; is_error: number; data: string }[];
    return rows.map((r) => ({
      ...(JSON.parse(r.data) as WorkflowEvent),
      id: r.id,
      sessionId,
      at: r.at,
      kind: r.kind,
      toolName: r.tool_name ?? undefined,
      isError: r.is_error === 1,
    }));
  }

  getMetrics(sessionId: string): SessionMetrics | null {
    const row = this.db
      .prepare("SELECT data FROM session_metrics WHERE session_id = ?")
      .get(sessionId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as SessionMetrics) : null;
  }

  recentSessions(since: number): SessionRecord[] {
    const rows = this.db
      .prepare("SELECT data FROM sessions WHERE started_at >= ? ORDER BY started_at")
      .all(since) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as SessionRecord);
  }

  addTags(sessionId: string, tags: string[]): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    const merged = [...new Set([...session.tags, ...tags])];
    session.tags = merged;
    this.upsertSession(session);
  }

  addCorrectionCandidate(candidate: CorrectionCandidate): void {
    this.db
      .prepare(
        `INSERT INTO correction_candidates (session_id, kind, at, data) VALUES (?, ?, ?, ?)`,
      )
      .run(candidate.sessionId, candidate.kind, candidate.at, JSON.stringify(candidate.detail));
  }

  aggregate(since: number): AggregateReport {
    const sessions = this.recentSessions(since);
    const sessionIds = sessions.map((s) => s.id);

    const events = this.db
      .prepare("SELECT kind FROM workflow_events WHERE at >= ?")
      .all(since) as { kind: string }[];
    const kindCounts: Record<string, number> = {};
    for (const e of events) kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;

    const outcomes: Record<string, number> = {};
    for (const s of sessions) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;

    const metrics = this.loadMetrics(sessionIds);
    const medians: Record<string, number | null> = {};
    for (const key of MEDIAN_KEYS) {
      medians[key] = median(metrics.map((m) => m[key] as number | null));
    }
    const p90s: Record<string, number | null> = {};
    for (const key of P90_KEYS) {
      p90s[key] = p90(metrics.map((m) => m[key] as number | null | undefined));
    }

    const totalCalls = metrics.reduce((n, m) => n + (m.toolCalls ?? 0), 0);
    const totalErrors = metrics.reduce((n, m) => n + (m.toolErrors ?? 0), 0);
    const totalRuns = metrics.reduce((n, m) => n + (m.validationRuns ?? 0), 0);
    const totalFailures = metrics.reduce((n, m) => n + (m.validationFailures ?? 0), 0);
    const rates: Record<string, number | null> = {};
    for (const key of RATE_KEYS) {
      rates[key] = median(metrics.map((m) => m[key] as number | null));
    }
    rates.validationFailureRate =
      totalRuns > 0 ? round4(totalFailures / totalRuns) : null;
    rates.overallToolErrorRate = totalCalls > 0 ? round4(totalErrors / totalCalls) : null;

    const errorsByTool: Record<string, number> = {};
    for (const m of metrics) {
      for (const [tool, n] of Object.entries(m.errorsByTool ?? {})) {
        errorsByTool[tool] = (errorsByTool[tool] ?? 0) + n;
      }
    }
    const topFailingTools = Object.entries(errorsByTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, errors]) => ({ tool, errors }));

    return {
      since,
      sessions: sessions.length,
      events: events.length,
      sessionOutcomes: outcomes,
      eventKindCounts: kindCounts,
      topFailingTools,
      medians,
      p90: p90s,
      rates,
    };
  }

  regressions(cohortSize = 20, minimumSize = 10): { recent: number; previous: number; changes: Record<string, number> } {
    const rows = this.db.prepare("SELECT id FROM sessions ORDER BY started_at DESC LIMIT ?").all(cohortSize * 2) as { id: string }[];
    const recentIds = rows.slice(0, cohortSize).map((row) => row.id);
    const previousIds = rows.slice(cohortSize, cohortSize * 2).map((row) => row.id);
    if (recentIds.length < minimumSize || previousIds.length < minimumSize) return { recent: recentIds.length, previous: previousIds.length, changes: {} };
    const recent = this.loadMetrics(recentIds);
    const previous = this.loadMetrics(previousIds);
    const changes: Record<string, number> = {};
    for (const key of ["toolCallsBeforeFirstEdit", "timeToFirstEditMs", "timeFirstEditToFirstValidationMs", "toolErrorRate", "validationFailures"] as const) {
      const a = median(recent.map((m) => m[key] as number | null));
      const b = median(previous.map((m) => m[key] as number | null));
      if (a == null || b == null || b === 0) continue;
      const change = (a - b) / Math.abs(b);
      if (Math.abs(change) >= 0.1) changes[key] = round4(change);
    }
    return { recent: recent.length, previous: previous.length, changes };
  }

  compare(tagA: string, tagB: string): { a: CohortComparison; b: CohortComparison } {
    const all = this.db
      .prepare("SELECT data FROM sessions")
      .all() as { data: string }[];
    const byTag = (tag: string): CohortComparison => {
      const sessions = all
        .map((r) => JSON.parse(r.data) as SessionRecord)
        .filter((s) => s.tags.includes(tag));
      const metrics = this.loadMetrics(sessions.map((s) => s.id));
      const medians: Record<string, number | null> = {};
      // Core exploration / validation / error fields.
      for (const key of [
        ...MEDIAN_KEYS,
        ...P90_KEYS,
        "toolErrorRate",
        "fileReadRedundancyRatio",
        "searchRedundancyRatio",
      ]) {
        medians[key] = median(metrics.map((m) => m[key] as number | null | undefined));
      }
      return { tag, count: sessions.length, medians };
    };
    return { a: byTag(tagA), b: byTag(tagB) };
  }

  private loadMetrics(sessionIds: string[]): SessionMetrics[] {
    if (sessionIds.length === 0) return [];
    const placeholders = sessionIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT data FROM session_metrics WHERE session_id IN (${placeholders})`)
      .all(...sessionIds) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as SessionMetrics);
  }

  private protectFiles(): void {
    for (const path of [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }

  close(): void {
    this.protectFiles();
    this.db.close();
  }
}

export interface PiTelemetryInfo {
  available: boolean;
  path: string;
  tables: Record<string, number> | null;
}

/**
 * Read-only probe of the pre-existing ~/.pi/agent/telemetry.db.
 * Never mutates or duplicates it — opens with readOnly and only counts tables.
 */
export function detectPiTelemetry(
  dbPath = join(homedir(), ".pi", "agent", "telemetry.db"),
): PiTelemetryInfo {
  if (!existsSync(dbPath)) return { available: false, path: dbPath, tables: null };
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const tables: Record<string, number> = {};
    for (const r of rows) {
      if (!/^[A-Za-z0-9_]+$/.test(r.name)) continue;
      const count = db.prepare(`SELECT count(*) AS n FROM \"${r.name}\"`).get() as { n: number };
      tables[r.name] = count.n;
    }
    db.close();
    return { available: true, path: dbPath, tables };
  } catch {
    return { available: false, path: dbPath, tables: null };
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}