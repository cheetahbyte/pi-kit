import { randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type SnippetMode = "next" | "first" | "every";

export class InvalidSnippetSettingsError extends Error {}

export function loadSnippetModes(path: string): Map<string, SnippetMode> {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    if (error instanceof SyntaxError) throw new InvalidSnippetSettingsError(`Invalid JSON in ${path}`, { cause: error });
    throw error;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidSnippetSettingsError(`Invalid snippet settings in ${path}: expected an object`);
  }
  const modes = new Map<string, SnippetMode>();
  for (const [id, mode] of Object.entries(data)) {
    if (mode !== "first" && mode !== "every") {
      throw new InvalidSnippetSettingsError(`Invalid snippet mode for ${id} in ${path}`);
    }
    modes.set(id, mode);
  }
  return modes;
}

export function saveSnippetModes(path: string, modes: Map<string, SnippetMode>, resetInvalid = false): string | undefined {
  let backup: string | undefined;
  try {
    loadSnippetModes(path);
  } catch (error) {
    if (!resetInvalid || !(error instanceof InvalidSnippetSettingsError)) throw error;
    backup = `${path}.${randomUUID()}.bak`;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const persisted = Object.fromEntries([...modes].filter(([, mode]) => mode !== "next"));
    writeFileSync(temporary, JSON.stringify(persisted, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (backup) copyFileSync(path, backup, constants.COPYFILE_EXCL);
    renameSync(temporary, path);
    return backup;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export type Snippet = {
  id: string;
  name: string;
  description: string;
  placement: "before" | "after";
  order: number;
  body: string;
};

export function parseSnippet(id: string, source: string): Snippet | undefined {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
  if (!match) return;

  const metadata = Object.fromEntries(
    match[1].split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf(":");
      return separator < 1
        ? []
        : [[line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")]];
    }),
  );
  const body = match[2].trim();
  if (!body) return;

  return {
    id,
    name: metadata.name || basename(id, ".md"),
    description: metadata.description || "",
    placement: metadata.placement === "before" ? "before" : "after",
    order: Number.isFinite(Number(metadata.order)) ? Number(metadata.order) : 100,
    body,
  };
}

export function loadSnippets(directories: string | string[]): Snippet[] {
  const byId = new Map<string, Snippet>();
  for (const directory of [directories].flat()) {
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory).filter((file) => file.endsWith(".md"))) {
      try {
        const snippet = parseSnippet(file, readFileSync(join(directory, file), "utf8"));
        if (snippet) byId.set(file, snippet);
      } catch {}
    }
  }
  return [...byId.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
