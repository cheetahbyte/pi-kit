import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { analyzeSession } from "./analyze.js";
import {
  classifyTool,
  DEFAULT_CONFIG,
  hash,
  isCorrection,
  mergeConfig,
  normalizedToolMetadata,
  type ClassificationConfig,
} from "./classifier.js";
import { aggregateReport, compareReport, sessionReport } from "./report.js";
import { detectPiTelemetry, EfficiencyRepository } from "./storage.js";
import type { SessionRecord, WorkflowEvent } from "./types.js";

const VERSION = "0.1.0";
const AGENT_DIR =
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const DB_PATH =
  process.env.PI_EFFICIENCY_DB ?? join(AGENT_DIR, "efficiency.db");

interface PendingTool {
  at: number;
  kind: WorkflowEvent["kind"];
  toolName: string;
  input: Record<string, unknown>;
  target?: string;
  range?: string;
  fingerprint: string;
  metadata: Record<string, unknown>;
}

export default function efficiencyExtension(pi: ExtensionAPI): void {
  let repo: EfficiencyRepository | undefined;
  let session: SessionRecord | undefined;
  let config = DEFAULT_CONFIG;
  let events: WorkflowEvent[] = [];
  let pendingBatch: WorkflowEvent[] = [];
  const pending = new Map<string, PendingTool>();
  const generations = new Map<string, number>();
  let lastAssistantCompleted = false;
  let significantWork = false;

  const ensureRepo = (): EfficiencyRepository =>
    (repo ??= new EfficiencyRepository(DB_PATH));
  const queue = (event: WorkflowEvent): void => {
    events.push(event);
    pendingBatch.push(event);
    if (pendingBatch.length >= 25) flush();
  };
  const flush = (): void => {
    if (!pendingBatch.length) return;
    ensureRepo().appendEvents(pendingBatch);
    pendingBatch = [];
  };
  const persist = (ctx: ExtensionContext, endedAt?: number): void => {
    if (!session) return;
    flush();
    session.endedAt = endedAt ?? session.endedAt;
    session.model = ctx.model?.id;
    session.provider = ctx.model?.provider;
    session.thinkingLevel = ctx.thinkingLevel;
    ensureRepo().upsertSession(session);
    ensureRepo().replaceMetrics(analyzeSession(events, session.id));
  };

  pi.on("session_start", async (_event, ctx) => {
    repo?.close();
    repo = new EfficiencyRepository(DB_PATH);
    config = loadConfig(ctx.cwd, ctx.isProjectTrusted());
    events = [];
    pendingBatch = [];
    pending.clear();
    generations.clear();
    significantWork = false;
    lastAssistantCompleted = false;
    const header = ctx.sessionManager.getHeader();
    session = {
      id: ctx.sessionManager.getSessionId(),
      startedAt: header ? Date.parse(header.timestamp) : Date.now(),
      cwd: ctx.cwd,
      project: basename(ctx.cwd),
      model: ctx.model?.id,
      provider: ctx.model?.provider,
      thinkingLevel: ctx.thinkingLevel,
      outcome: "unknown",
      tags:
        process.env.PI_EFFICIENCY_TAGS?.split(",")
          .map((x) => x.trim())
          .filter(Boolean) ?? [],
      piVersion: process.env.PI_VERSION,
      extensionVersion: VERSION,
    };
    const git = await cheapGit(pi, ctx.cwd);
    session.gitBranch = git.branch;
    session.gitCommit = git.commit;
    repo.upsertSession(session);
  });

  pi.on("message_end", (event, ctx) => {
    if (!session) return;
    const at = event.message.timestamp ?? Date.now();
    if (event.message.role === "user") {
      const text =
        typeof event.message.content === "string"
          ? event.message.content
          : event.message.content
              .filter((x) => x.type === "text")
              .map((x) => x.text)
              .join("\n");
      queue({ sessionId: session.id, at, kind: "user_message" });
      if (significantWork && lastAssistantCompleted) {
        ensureRepo().addCorrectionCandidate({
          sessionId: session.id,
          at,
          kind: "correction",
          detail: { highConfidence: isCorrection(text, config) },
        });
      }
      lastAssistantCompleted = false;
    } else if (event.message.role === "assistant") {
      queue({
        sessionId: session.id,
        at,
        kind: "assistant_turn",
        isError: event.message.stopReason === "error",
        metadata: {
          stopReason: event.message.stopReason,
          inputTokens: event.message.usage?.input,
          outputTokens: event.message.usage?.output,
        },
      });
      lastAssistantCompleted = event.message.stopReason === "stop";
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (!session) return;
    const input = (event.args ?? {}) as Record<string, unknown>;
    const kind = classifyTool(event.toolName, input, config);
    const normalized = normalizedToolMetadata(kind, input, ctx.cwd);
    pending.set(event.toolCallId, {
      at: Date.now(),
      kind,
      toolName: event.toolName,
      input,
      ...normalized,
    });
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (!session) return;
    const call = pending.get(event.toolCallId);
    if (!call) return;
    pending.delete(event.toolCallId);
    const at = Date.now();
    const result = (event.result ?? {}) as {
      details?: Record<string, unknown>;
      content?: Array<{ type: string; text?: string }>;
    };
    const exitCode =
      typeof result.details?.exitCode === "number"
        ? result.details.exitCode
        : undefined;
    const failed =
      event.isError ||
      (call.kind === "validation" && exitCode !== undefined && exitCode !== 0);
    if ((call.kind === "edit" || call.kind === "write") && call.target) {
      generations.set(call.target, (generations.get(call.target) ?? 0) + 1);
      significantWork = true;
    }
    const errorText = failed
      ? result.content
          ?.filter((x) => x.type === "text")
          .map((x) => x.text ?? "")
          .join("\n")
          .slice(0, 2048)
      : "";
    queue({
      sessionId: session.id,
      at: call.at,
      kind: call.kind,
      toolName: call.toolName,
      toolCallId: event.toolCallId,
      target: call.target,
      range: call.range,
      fingerprint: failed
        ? hash(`${call.toolName}:${call.fingerprint}:${errorText}`)
        : call.fingerprint,
      fileGeneration: call.target
        ? (generations.get(call.target) ?? 0)
        : undefined,
      durationMs: at - call.at,
      isError: failed,
      result:
        call.kind === "validation" ? (failed ? "fail" : "pass") : undefined,
      metadata: call.metadata,
    });
  });

  pi.on("session_compact", (event) => {
    if (!session) return;
    queue({
      sessionId: session.id,
      at: Date.now(),
      kind: "compaction",
      metadata: {
        reason: event.reason,
        tokensBefore: event.compactionEntry.tokensBefore,
      },
    });
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!session) return;
    if (lastAssistantCompleted) {
      session.outcome = "completed";
      queue({ sessionId: session.id, at: Date.now(), kind: "completion" });
    }
    persist(ctx);
  });

  const subagentDone = (data: unknown): void => {
    if (!session || !data || typeof data !== "object") return;
    const d = data as Record<string, unknown>;
    queue({
      sessionId: session.id,
      at: Date.now(),
      kind: "subagent",
      toolName: "Agent",
      durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
      isError: d.status === "failed",
      metadata: {
        phase: "completion",
        toolCalls: d.toolUses,
        tokens: d.tokens,
        type: d.type,
      },
    });
  };
  pi.events.on("subagents:completed", subagentDone);
  pi.events.on("subagents:failed", subagentDone);

  pi.on("session_shutdown", (event, ctx) => {
    if (!session) return;
    if (event.reason !== "quit" && session.outcome === "unknown")
      session.outcome = "interrupted";
    persist(ctx, Date.now());
    repo?.close();
    repo = undefined;
  });

  pi.registerCommand("efficiency", {
    description:
      "Show workflow efficiency metrics; session, 7d, compare, tag, export",
    handler: async (args, ctx) => {
      if (!session) return;
      persist(ctx);
      const [command = "session", ...rest] = args
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (command === "compare" && rest.length >= 2) {
        const cohorts = ensureRepo().compare(rest[0], rest[1]);
        return notify(ctx, compareReport(cohorts.a, cohorts.b));
      }
      if (command === "regression") {
        const result = ensureRepo().regressions();
        const changes = Object.entries(result.changes)
          .map(
            ([key, value]) =>
              `${key}: ${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`,
          )
          .join("\n");
        return notify(
          ctx,
          changes ||
            `Not enough meaningful change (recent n=${result.recent}, previous n=${result.previous}; minimum 10 each).`,
        );
      }
      if (command === "tag" && rest.length) {
        ensureRepo().addTags(session.id, rest);
        session.tags = [...new Set([...session.tags, ...rest])];
        return notify(ctx, `Tagged session: ${rest.join(", ")}`);
      }
      if (command === "export") {
        const directory = join(AGENT_DIR, "efficiency-exports");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, `efficiency-${session.id}.json`);
        writeFileSync(
          path,
          JSON.stringify(
            {
              session: ensureRepo().getSession(session.id),
              metrics: ensureRepo().getMetrics(session.id),
              events: ensureRepo().getEvents(session.id),
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        return notify(ctx, `Exported private local report: ${path}`);
      }
      const range = parseRange(command);
      if (range !== null)
        return notify(
          ctx,
          aggregateReport(ensureRepo().aggregate(Date.now() - range)),
        );
      const metrics = ensureRepo().getMetrics(session.id);
      if (metrics) notify(ctx, sessionReport(session, metrics));
    },
  });

  pi.registerCommand("efficiency-telemetry", {
    description: "Show whether canonical pi-telemetry SQLite is available",
    handler: async (_args, ctx) =>
      notify(ctx, JSON.stringify(detectPiTelemetry(), null, 2)),
  });
}

function loadConfig(cwd: string, trusted: boolean): ClassificationConfig {
  let config: Partial<ClassificationConfig> = {};
  for (const path of [
    join(AGENT_DIR, "efficiency.json"),
    ...(trusted ? [join(cwd, ".pi", "efficiency.json")] : []),
  ]) {
    try {
      config = { ...config, ...JSON.parse(readFileSync(path, "utf8")) };
    } catch {
      /* absent or invalid config uses safe defaults */
    }
  }
  return mergeConfig(config);
}

async function cheapGit(
  pi: ExtensionAPI,
  cwd: string,
): Promise<{ branch?: string; commit?: string }> {
  const result = await pi.exec(
    "git",
    ["-C", cwd, "status", "--porcelain=v2", "--branch"],
    { timeout: 1000 },
  );
  if (result.code !== 0) return {};
  const branch = result.stdout.match(/^# branch\.head (.+)$/m)?.[1];
  const commit = result.stdout.match(/^# branch\.oid (.+)$/m)?.[1];
  return { branch, commit };
}

function parseRange(value: string): number | null {
  const match = value.match(/^(\d+)([dh])$/);
  if (!match) return null;
  return Number(match[1]) * (match[2] === "d" ? 86_400_000 : 3_600_000);
}

function notify(ctx: ExtensionContext, text: string): void {
  if (ctx.hasUI) ctx.ui.notify(text, "info");
  else console.log(text);
}
