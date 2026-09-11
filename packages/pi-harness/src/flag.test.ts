import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "./config.ts";
import { newSignals, recordToolResult, recordUserText, shouldFlag } from "./flag.ts";

const P = DEFAULT_CONFIG.correctionPatterns;

function withUsers(n: number) {
  const s = newSignals();
  for (let i = 0; i < n; i++) recordUserText(s, `please do task ${i}`, P);
  return s;
}

describe("shouldFlag", () => {
  test("short sessions are never flagged", () => {
    const s = withUsers(2);
    recordUserText(s, "no, that is wrong", P);
    expect(shouldFlag(s, DEFAULT_CONFIG).flagged).toBe(false);
  });

  test("one correction flags", () => {
    const s = withUsers(4);
    recordUserText(s, "No, revert that", P);
    const r = shouldFlag(s, DEFAULT_CONFIG);
    expect(r.flagged).toBe(true);
    expect(r.reasons).toContain("corrections=1");
  });

  test("two identical errors flag", () => {
    const s = withUsers(4);
    recordToolResult(s, "bash", true, "command not found: foo");
    recordToolResult(s, "bash", true, "command not found: foo");
    expect(shouldFlag(s, DEFAULT_CONFIG).reasons).toContain("identicalErrors=2");
  });

  test("error rate flags only with enough calls", () => {
    const s = withUsers(4);
    for (let i = 0; i < 3; i++) recordToolResult(s, "read", true, `err ${i}`);
    for (let i = 0; i < 6; i++) recordToolResult(s, "read", false, "");
    expect(shouldFlag(s, DEFAULT_CONFIG).flagged).toBe(false);
    recordToolResult(s, "read", false, "");
    expect(shouldFlag(s, DEFAULT_CONFIG).flagged).toBe(true);
  });

  test("clean session is not flagged", () => {
    const s = withUsers(10);
    for (let i = 0; i < 20; i++) recordToolResult(s, "read", false, "");
    expect(shouldFlag(s, DEFAULT_CONFIG).flagged).toBe(false);
  });
});
