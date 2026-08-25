import type { AggregateReport, CohortComparison } from "./storage.js";
import type { SessionMetrics, SessionRecord } from "./types.js";

const n = (value: number | null | undefined): string => value == null ? "n/a" : String(Math.round(value * 100) / 100);
const duration = (ms: number | null | undefined): string => {
  if (ms == null) return "n/a";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const percent = (value: number | null | undefined): string => value == null ? "n/a" : `${Math.round(value * 1000) / 10}%`;

export function sessionReport(session: SessionRecord, m: SessionMetrics): string {
  const signals: string[] = [];
  if (m.repeatedSameRangeReads) signals.push(`${m.repeatedSameRangeReads} unchanged same-range rereads`);
  if (m.editOperationsBeforeFirstValidation > 3) signals.push(`validation followed ${m.editOperationsBeforeFirstValidation} edits`);
  if (m.failureLoops) signals.push(`${m.failureLoops} repeated failure loop(s)`);
  return [
    `Session: ${session.project}`,
    `Model: ${session.provider ?? "unknown"}/${session.model ?? "unknown"}`,
    `Duration: ${duration(m.sessionDurationMs)}`,
    "",
    "Exploration",
    `  ${m.toolCallsBeforeFirstEdit} tool calls before first edit`,
    `  ${m.readsBeforeFirstEdit} reads; ${m.searchesBeforeFirstEdit} searches; ${m.semanticNavigationBeforeFirstEdit} semantic navigation`,
    `  ${m.repeatedSameRangeReads} repeated same-range reads`,
    "",
    "Editing",
    `  ${m.editOperations} operations across ${m.filesModified} files`,
    `  ${m.editOperationsBeforeFirstValidation} edits before first validation`,
    "",
    "Validation",
    `  first validation: ${duration(m.timeFirstEditToFirstValidationMs)} after first edit`,
    `  ${m.validationRuns} runs; ${m.validationFailures} failed; final: ${m.finalValidationResult ?? "none"}`,
    "",
    "Errors",
    `  ${m.toolErrors} / ${m.toolCalls} tool calls (${percent(m.toolErrorRate)})`,
    `  repeated identical errors: ${m.repeatedIdenticalErrors}`,
    ...(signals.length ? ["", "Potential inefficiency signals", ...signals.map((x) => `  ${x}`)] : []),
  ].join("\n");
}

export function aggregateReport(r: AggregateReport): string {
  return [
    `Sessions: ${r.sessions}`,
    `Median tool calls: ${n(r.medians.toolCalls)}`,
    `Median reads: ${n(r.medians.totalFileReads)}`,
    `Read redundancy: ${percent(r.rates.fileReadRedundancyRatio)}`,
    `Search redundancy: ${percent(r.rates.searchRedundancyRatio)}`,
    `Validation failure rate: ${percent(r.rates.validationFailureRate)}`,
    `Tool error rate: ${percent(r.rates.overallToolErrorRate)}`,
    `Median subagent calls: ${n(r.medians.subagentCalls)}`,
    `Outcomes: ${Object.entries(r.sessionOutcomes).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `Top failing tools: ${r.topFailingTools.map((x) => `${x.tool} (${x.errors})`).join(", ") || "none"}`,
  ].join("\n");
}

export function compareReport(a: CohortComparison, b: CohortComparison): string {
  const keys = ["toolCalls", "totalFileReads", "timeToFirstEditMs", "editOperationsBeforeFirstValidation", "toolErrorRate"];
  return [
    `${a.tag} (n=${a.count}) vs ${b.tag} (n=${b.count})`,
    ...keys.map((key) => `${key}: ${n(a.medians[key])} vs ${n(b.medians[key])}`),
  ].join("\n");
}
