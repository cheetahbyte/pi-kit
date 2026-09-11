import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnessConfig {
  model: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  auto: boolean;
  maxDigestChars: number;
  minUserMessages: number;
  correctionPatterns: string[];
  errorRateThreshold: number;
  auditSessions: number;
}

export const DEFAULT_CONFIG: HarnessConfig = {
  model: "openai-codex/gpt-5.6-luna",
  thinking: "medium",
  auto: true,
  maxDigestChars: 60_000,
  minUserMessages: 4,
  correctionPatterns: [
    "^\\s*(?:no|wrong)[,.!\\s]",
    "that's not what i meant",
    "\\b(?:revert|undo)\\b",
    "you changed .+ but i asked",
  ],
  errorRateThreshold: 0.2,
  auditSessions: 30,
};

const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function safeRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return pattern.length <= 200;
  } catch {
    return false;
  }
}

export function loadConfig(dir: string): HarnessConfig {
  const file = join(dir, "config.json");
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const str = (v: unknown, d: string): string => (typeof v === "string" && v.length > 0 ? v : d);
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
  const patterns =
    Array.isArray(raw.correctionPatterns) && raw.correctionPatterns.every((p) => typeof p === "string" && safeRegex(p))
      ? (raw.correctionPatterns as string[])
      : DEFAULT_CONFIG.correctionPatterns;
  const thinking =
    typeof raw.thinking === "string" && THINKING.has(raw.thinking)
      ? (raw.thinking as HarnessConfig["thinking"])
      : DEFAULT_CONFIG.thinking;
  return {
    model: str(raw.model, DEFAULT_CONFIG.model),
    thinking,
    auto: bool(raw.auto, DEFAULT_CONFIG.auto),
    maxDigestChars: num(raw.maxDigestChars, DEFAULT_CONFIG.maxDigestChars),
    minUserMessages: num(raw.minUserMessages, DEFAULT_CONFIG.minUserMessages),
    correctionPatterns: patterns,
    errorRateThreshold: num(raw.errorRateThreshold, DEFAULT_CONFIG.errorRateThreshold),
    auditSessions: num(raw.auditSessions, DEFAULT_CONFIG.auditSessions),
  };
}
