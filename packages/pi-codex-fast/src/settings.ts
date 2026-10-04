import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function settingsPath(directory: string, provider: string, model: string): string {
  return join(directory, `${encodeURIComponent(provider)}--${encodeURIComponent(model)}.json`);
}

export function readPreference(directory: string, provider: string, model: string): boolean {
  let content: string;
  try {
    content = readFileSync(settingsPath(directory, provider, model), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  const value: unknown = JSON.parse(content);
  if (typeof value !== "boolean") throw new Error("Fast-mode preference must be a boolean");
  return value;
}

export function writePreference(directory: string, provider: string, model: string, enabled: boolean): void {
  mkdirSync(directory, { recursive: true });
  const destination = settingsPath(directory, provider, model);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(enabled)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}
