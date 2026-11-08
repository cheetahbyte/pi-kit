// Plan limits come from Claude Code's own `get_usage` control request, as in NousResearch's
// claude-subscription-directsdk: the CLI uses the login it holds and sends no Messages request.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findClaude, killTree, STRIPPED_ENV } from "./provider.ts";

type Row = Record<string, unknown>;
export type UsageWindow = { label: string; percent: number; resetsAt?: Date };
export type UsageResult = { windows: UsageWindow[]; reason?: undefined } | { windows?: undefined; reason: string };

const REQUEST_ID = "pi-usage";
const TIMEOUT_MS = 10_000;
const LABELS: Record<string, string> = { session: "Session", weekly_all: "Week" };
// Older responses carry only top-level windows, without `limits`.
const LEGACY: [string, string][] = [
  ["five_hour", "Session"],
  ["seven_day", "Week"],
  ["seven_day_opus", "Opus week"],
  ["seven_day_sonnet", "Sonnet week"],
];

const record = (value: unknown): Row | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : undefined;
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const date = (value: unknown): Date | undefined => {
  const parsed = typeof value === "string" ? new Date(value) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
};

export function usageWindows(rateLimits: Row): UsageWindow[] {
  const limits = Array.isArray(rateLimits.limits) ? rateLimits.limits.map(record).filter((row) => row !== undefined) : [];
  if (limits.length) {
    return limits.flatMap((limit) => {
      const percent = finite(limit.percent);
      if (percent === undefined) return [];
      const kind = typeof limit.kind === "string" ? limit.kind : "unknown";
      const model = record(record(limit.scope)?.model)?.display_name;
      const label = LABELS[kind] ?? (typeof model === "string" && model ? `${model} week` : kind);
      return [{ label, percent, resetsAt: date(limit.resets_at) }];
    });
  }
  return LEGACY.flatMap(([key, label]) => {
    const window = record(rateLimits[key]);
    const percent = finite(window?.utilization);
    return percent === undefined ? [] : [{ label, percent, resetsAt: date(window?.resets_at) }];
  });
}

export async function fetchUsage(): Promise<UsageResult> {
  let command: string;
  try {
    command = findClaude();
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STRIPPED_ENV) delete env[key];
  const dir = mkdtempSync(join(tmpdir(), "pi-claude-usage-"));
  const args = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands", "--no-session-persistence",
  ];
  const child = spawn(command, args, { cwd: dir, env, stdio: ["pipe", "pipe", "ignore"], detached: process.platform !== "win32" });
  const timer = setTimeout(() => killTree(child), TIMEOUT_MS);
  try {
    const failed = new Promise<undefined>((resolve) => {
      child.once("error", () => resolve(undefined));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify({ type: "control_request", request_id: REQUEST_ID, request: { subtype: "get_usage", skip_behaviors: true } })}\n`);
    const answer = async (): Promise<Row | undefined> => {
      for await (const line of createInterface({ input: child.stdout })) {
        if (!line.startsWith("{")) continue;
        let row: Row | undefined;
        try {
          row = record(JSON.parse(line));
        } catch {
          continue;
        }
        const response = record(row?.response);
        if (row?.type === "control_response" && response?.request_id === REQUEST_ID) return response;
      }
      return undefined;
    };
    const response = await Promise.race([answer(), failed]);
    if (!response) return { reason: "Claude Code gave no usage answer. Update it with `claude update`." };
    if (response.subtype !== "success") return { reason: "Claude Code refused the usage request. Update it with `claude update`." };
    const body = record(response.response) ?? {};
    const rateLimits = record(body.rate_limits);
    if (rateLimits) return { windows: usageWindows(rateLimits) };
    return { reason: body.rate_limits_available ? "Claude Code returned no plan limits." : "No Claude subscription login found. Run `claude auth login`." };
  } finally {
    clearTimeout(timer);
    killTree(child);
    rmSync(dir, { recursive: true, force: true });
  }
}

const formatReset = (at: Date): string =>
  at.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

export function registerUsage(pi: ExtensionAPI): void {
  pi.registerCommand("claude-usage", {
    description: "Show Claude subscription plan limits",
    handler: async (_args, ctx) => {
      const result = await fetchUsage();
      if (!result.windows) return ctx.ui.notify(result.reason, "error");
      if (!result.windows.length) return ctx.ui.notify("Claude Code reported no plan limits.", "info");
      const lines = result.windows.map(({ label, percent, resetsAt }) =>
        `${label}: ${Math.round(percent)}% used${resetsAt ? `, resets ${formatReset(resetsAt)}` : ""}`);
      ctx.ui.notify(["Claude plan limits", ...lines].join("\n"), "info");
    },
  });
}
