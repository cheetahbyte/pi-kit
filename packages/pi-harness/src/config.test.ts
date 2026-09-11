import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  test("returns defaults when file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-"));
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  test("merges valid overrides and ignores invalid ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        model: "openai-codex/gpt-5.6-sol",
        auto: "yes",
        correctionPatterns: ["^nope", "("],
        auditSessions: 12,
      }),
    );
    const cfg = loadConfig(dir);
    expect(cfg.model).toBe("openai-codex/gpt-5.6-sol");
    expect(cfg.auto).toBe(true);
    expect(cfg.correctionPatterns).toEqual(DEFAULT_CONFIG.correctionPatterns);
    expect(cfg.auditSessions).toBe(12);
  });

  test("returns defaults on malformed json", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-"));
    writeFileSync(join(dir, "config.json"), "{nope");
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });
});
