import type { EvalConfig } from "./config.ts";

export interface SessionSignals {
  userMessages: number;
  corrections: number;
  toolCalls: number;
  toolErrors: number;
  errorKeys: Map<string, number>;
}

export function newSignals(): SessionSignals {
  return { userMessages: 0, corrections: 0, toolCalls: 0, toolErrors: 0, errorKeys: new Map() };
}

export function isCorrection(text: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(text));
}

export function recordUserText(s: SessionSignals, text: string, patterns: string[]): void {
  s.userMessages += 1;
  if (isCorrection(text, patterns)) s.corrections += 1;
}

export function recordToolResult(s: SessionSignals, toolName: string, isError: boolean, errorText: string): void {
  s.toolCalls += 1;
  if (!isError) return;
  s.toolErrors += 1;
  const key = `${toolName}:${errorText.slice(0, 120)}`;
  s.errorKeys.set(key, (s.errorKeys.get(key) ?? 0) + 1);
}

export function shouldFlag(s: SessionSignals, cfg: EvalConfig): { flagged: boolean; reasons: string[] } {
  if (s.userMessages < cfg.minUserMessages) return { flagged: false, reasons: [] };
  const reasons: string[] = [];
  if (s.corrections >= 1) reasons.push(`corrections=${s.corrections}`);
  const identical = Math.max(0, ...s.errorKeys.values());
  if (identical >= 2) reasons.push(`identicalErrors=${identical}`);
  if (s.toolCalls >= 10 && s.toolErrors / s.toolCalls > cfg.errorRateThreshold) {
    reasons.push(`errorRate=${(s.toolErrors / s.toolCalls).toFixed(2)}`);
  }
  return { flagged: reasons.length > 0, reasons };
}
