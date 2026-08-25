import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

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

export function loadSnippets(directory: string): Snippet[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .flatMap((file) => {
      try {
        const snippet = parseSnippet(file, readFileSync(join(directory, file), "utf8"));
        return snippet ? [snippet] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
