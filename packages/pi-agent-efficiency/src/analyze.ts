// Deterministic session metrics derived from workflow events.
//
// Every metric is computed from objective event signals only (kinds,
// timestamps, target/range/fingerprint metadata, file generations). There is
// no subjective efficiency score. Derivation is a single stable pass over
// events sorted by `at` (ties keep input order) so results are reproducible.

import type { SessionMetrics, WorkflowEvent } from "./types.js";

/** Event kinds that count as a tool call. `tool_error` is a failure marker,
 * not a call; `completion`/`user_message`/`assistant_turn` are not tools. */
const TOOL_KINDS: ReadonlySet<WorkflowEvent["kind"]> = new Set([
  "search",
  "read",
  "semantic_navigation",
  "edit",
  "write",
  "validation",
  "bash",
  "subagent",
]);

/** Short stable label for `sequence`: user/assistant turns are normalized
 * and validation results are appended so tool analysis can read the flow. */
function sequenceEntry(e: WorkflowEvent): string {
  if (e.kind === "user_message") return "user";
  if (e.kind === "assistant_turn") return "assistant";
  if (e.kind === "validation") {
    return e.result === "pass"
      ? "validation:pass"
      : e.result === "fail"
        ? "validation:fail"
        : "validation";
  }
  return e.kind;
}

function zeroMetrics(
  sessionId: string,
  sessionDurationMs: number,
): SessionMetrics {
  return {
    sessionId,
    sessionDurationMs,
    toolCalls: 0,
    toolCallsBeforeFirstEdit: 0,
    readsBeforeFirstEdit: 0,
    searchesBeforeFirstEdit: 0,
    semanticNavigationBeforeFirstEdit: 0,
    timeToFirstEditMs: null,
    totalFileReads: 0,
    uniqueFilesRead: 0,
    repeatedFileReads: 0,
    repeatedSameRangeReads: 0,
    differentRangeRereads: 0,
    rereadsAfterModification: 0,
    rereadsAfterCompaction: 0,
    fileReadRedundancyRatio: 0,
    uniqueSearches: 0,
    repeatedSearches: 0,
    searchRedundancyRatio: 0,
    filesModified: 0,
    editOperations: 0,
    editsPerModifiedFile: 0,
    timeFirstEditToFirstValidationMs: null,
    editOperationsBeforeFirstValidation: 0,
    sameRegionReedits: 0,
    sameFileReedits: 0,
    editRevertCycles: 0,
    validationRuns: 0,
    validationFailures: 0,
    validationSuccesses: 0,
    editsBetweenValidations: [],
    timeBetweenEditAndValidationMs: [],
    firstValidationResult: null,
    finalValidationResult: null,
    toolErrors: 0,
    toolErrorRate: 0,
    errorsByTool: {},
    repeatedIdenticalErrors: 0,
    failureLoops: 0,
    subagentCalls: 0,
    subagentDurationMs: 0,
    subagentToolCalls: null,
    subagentTokens: null,
    compactions: 0,
    messages: 0,
    modelTurns: 0,
    sequence: [],
  };
}

export function analyzeSession(
  events: WorkflowEvent[],
  sessionId = "",
): SessionMetrics {
  // Stable sort: ascending `at`, input order preserved on ties.
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const m = zeroMetrics(
    first?.sessionId ?? sessionId,
    sorted.length > 1 ? last.at - first.at : 0,
  );

  let firstEditIdx = -1;
  let firstEditAt: number | null = null;
  let lastEditAt: number | null = null;
  let firstValidationIdx = -1;
  let firstValidationAt: number | null = null;
  let editsSinceLastValidation = 0;
  let searches = 0;

  // Per-target read state: file generation and range at the last read.
  const readState = new Map<
    string,
    { gen: number; range: string | undefined }
  >();
  // Targets read before a compaction that haven't been re-read since.
  const compactedSinceLastRead = new Set<string>();
  // Current file generation per target, bumped by edit/write events.
  const fileGen = new Map<string, number>();
  const searchKeys = new Set<string>();
  const modifiedFiles = new Set<string>();
  const editedRegions = new Set<string>();
  const editFingerprints = new Map<string, string[]>();
  const seenErrorFingerprints = new Set<string>();
  // Run of consecutive identical validation failures (failure loop).
  let failRunKey: string | null = null;
  let failRunLen = 0;
  const closeFailRun = (): void => {
    if (failRunLen >= 3) m.failureLoops += Math.floor(failRunLen / 3);
    failRunKey = null;
    failRunLen = 0;
  };

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];

    if (e.kind === "user_message" || e.kind === "assistant_turn") {
      m.messages++;
      if (e.kind === "assistant_turn") m.modelTurns++;
    }
    if (TOOL_KINDS.has(e.kind) && e.metadata?.phase !== "completion") {
      m.toolCalls++;
      // Strictly before the first edit: edit/write events themselves never count.
      if (firstEditIdx === -1 && e.kind !== "edit" && e.kind !== "write") {
        m.toolCallsBeforeFirstEdit++;
      }
    }
    // Phase counters: events strictly before the first edit/write.
    if (firstEditIdx === -1) {
      if (e.kind === "read") m.readsBeforeFirstEdit++;
      else if (e.kind === "search") m.searchesBeforeFirstEdit++;
      else if (e.kind === "semantic_navigation")
        m.semanticNavigationBeforeFirstEdit++;
    }

    switch (e.kind) {
      case "read": {
        m.totalFileReads++;
        const target = e.target;
        if (target !== undefined) {
          const genAtRead = e.fileGeneration ?? fileGen.get(target) ?? 0;
          const prev = readState.get(target);
          if (prev === undefined) {
            readState.set(target, { gen: genAtRead, range: e.range });
          } else {
            // Reread: classify by the strongest objective signal.
            // 1. file generation advanced since the last read -> modification
            // 2. a compaction happened since the last read
            // 3. same target and range with unchanged generation
            // 4. otherwise: a different range (or one we cannot prove equal)
            if (genAtRead > prev.gen) {
              m.rereadsAfterModification++;
            } else if (compactedSinceLastRead.has(target)) {
              m.rereadsAfterCompaction++;
              compactedSinceLastRead.delete(target);
            } else if (e.range !== undefined && e.range === prev.range) {
              m.repeatedSameRangeReads++;
            } else {
              m.differentRangeRereads++;
            }
            prev.gen = genAtRead;
            prev.range = e.range;
          }
        }
        break;
      }
      case "search": {
        searches++;
        // Repeats are identified by search fingerprint when present.
        const key =
          e.fingerprint ??
          (e.target === undefined ? undefined : `target:${e.target}`);
        if (key !== undefined) searchKeys.add(key);
        break;
      }
      case "edit":
      case "write": {
        m.editOperations++;
        if (firstEditIdx === -1) {
          firstEditIdx = i;
          firstEditAt = e.at;
        }
        lastEditAt = e.at;
        editsSinceLastValidation++;
        if (firstValidationIdx === -1) m.editOperationsBeforeFirstValidation++;
        if (e.target !== undefined) {
          if (modifiedFiles.has(e.target)) m.sameFileReedits++;
          else modifiedFiles.add(e.target);
          // Edit/write bumps the file generation: trust the event's own
          // generation when recorded, otherwise increment the tracked one.
          fileGen.set(
            e.target,
            e.fileGeneration ?? (fileGen.get(e.target) ?? 0) + 1,
          );
          if (e.range !== undefined) {
            const regionKey = `${e.target}\u0000${e.range}`;
            if (editedRegions.has(regionKey)) m.sameRegionReedits++;
            else editedRegions.add(regionKey);
          }
          // Revert cycle: content returns to a fingerprint this file
          // produced earlier (conservative: fingerprints must be present).
          if (e.fingerprint !== undefined) {
            const seen = editFingerprints.get(e.target) ?? [];
            if (seen.includes(e.fingerprint)) m.editRevertCycles++;
            seen.push(e.fingerprint);
            editFingerprints.set(e.target, seen);
          }
        }
        break;
      }
      case "validation": {
        m.validationRuns++;
        const failed = e.result === "fail" || e.isError === true;
        if (failed) m.validationFailures++;
        else if (e.result === "pass") m.validationSuccesses++;
        if (firstValidationIdx === -1) {
          firstValidationIdx = i;
          firstValidationAt = e.at;
          m.firstValidationResult = e.result ?? null;
        }
        m.finalValidationResult = e.result ?? null;
        m.editsBetweenValidations.push(editsSinceLastValidation);
        editsSinceLastValidation = 0;
        if (lastEditAt !== null) {
          m.timeBetweenEditAndValidationMs.push(e.at - lastEditAt);
        }
        if (failed) {
          const key =
            e.fingerprint ?? `${e.target ?? ""}\u0000${e.range ?? ""}`;
          if (key === failRunKey) {
            failRunLen++;
          } else {
            closeFailRun();
            failRunKey = key;
            failRunLen = 1;
          }
        } else {
          closeFailRun();
        }
        break;
      }
      default:
        break;
    }

    if (e.kind === "compaction") {
      m.compactions++;
      for (const target of readState.keys()) compactedSinceLastRead.add(target);
    }
    if (e.kind === "subagent") {
      if (e.metadata?.phase !== "completion") m.subagentCalls++;
      if (
        e.metadata?.phase === "completion" ||
        e.metadata?.phase === undefined
      ) {
        m.subagentDurationMs += e.durationMs ?? 0;
        if (typeof e.metadata?.toolCalls === "number") {
          m.subagentToolCalls =
            (m.subagentToolCalls ?? 0) + e.metadata.toolCalls;
        }
        if (typeof e.metadata?.tokens === "number") {
          m.subagentTokens = (m.subagentTokens ?? 0) + e.metadata.tokens;
        }
      }
    }
    if (e.kind === "tool_error" || e.isError === true) {
      m.toolErrors++;
      const tool = e.toolName ?? "unknown";
      m.errorsByTool[tool] = (m.errorsByTool[tool] ?? 0) + 1;
      // Identical errors are identified by fingerprint only (conservative).
      if (e.fingerprint !== undefined) {
        if (seenErrorFingerprints.has(e.fingerprint))
          m.repeatedIdenticalErrors++;
        else seenErrorFingerprints.add(e.fingerprint);
      }
    }

    if (e.metadata?.phase !== "completion") m.sequence.push(sequenceEntry(e));
  }

  closeFailRun();

  m.uniqueFilesRead = readState.size;
  m.repeatedFileReads = m.totalFileReads - m.uniqueFilesRead;
  m.fileReadRedundancyRatio =
    m.totalFileReads > 0 ? m.repeatedFileReads / m.totalFileReads : 0;
  m.uniqueSearches = searchKeys.size;
  m.repeatedSearches = searches - m.uniqueSearches;
  m.searchRedundancyRatio = searches > 0 ? m.repeatedSearches / searches : 0;
  m.filesModified = modifiedFiles.size;
  m.editsPerModifiedFile =
    m.filesModified > 0 ? m.editOperations / m.filesModified : 0;
  m.toolErrorRate = m.toolCalls > 0 ? m.toolErrors / m.toolCalls : 0;
  m.timeToFirstEditMs =
    firstEditAt === null ? null : firstEditAt - (first?.at ?? 0);
  m.timeFirstEditToFirstValidationMs =
    firstEditAt === null || firstValidationAt === null
      ? null
      : firstValidationAt - firstEditAt;

  return m;
}
