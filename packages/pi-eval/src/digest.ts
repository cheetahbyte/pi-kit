type Block = { type: string; text?: string; name?: string; id?: string; arguments?: Record<string, unknown> };
type Msg = { role?: string; content?: string | Block[]; toolName?: string; toolCallId?: string; isError?: boolean };

interface Line {
  kind: "user" | "assistant" | "tool" | "compaction";
  text: string;
}

const ASSISTANT_MAX = 600;
const ERROR_MAX = 200;

function textBlocks(content: string | Block[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

export function userTextOf(message: unknown): string | undefined {
  const m = message as Msg;
  if (!m || m.role !== "user") return undefined;
  return textBlocks(m.content);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function extractLines(jsonl: string): Line[] {
  const out: Line[] = [];
  const pendingCalls = new Map<string, number>();
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let entry: { type?: string; message?: Msg };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (entry.type === "compaction") {
      out.push({ kind: "compaction", text: "--- compaction ---" });
      continue;
    }
    if (entry.type !== "message" || !entry.message) continue;
    const m = entry.message;
    if (m.role === "user") {
      out.push({ kind: "user", text: `USER: ${textBlocks(m.content)}` });
    } else if (m.role === "assistant") {
      const text = textBlocks(m.content).trim();
      if (text) out.push({ kind: "assistant", text: `ASSISTANT: ${truncate(text, ASSISTANT_MAX)}` });
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === "toolCall" && b.name) {
            const args = JSON.stringify(b.arguments ?? {});
            pendingCalls.set(b.id ?? "", out.length);
            out.push({ kind: "tool", text: `[${b.name}] ${truncate(args, 200)}` });
          }
        }
      }
    } else if (m.role === "toolResult") {
      const id = m.toolCallId ?? "";
      const idx = pendingCalls.get(id);
      if (m.isError) {
        const err = truncate(textBlocks(m.content).replace(/\s+/g, " ").trim(), ERROR_MAX);
        if (idx !== undefined && out[idx]) out[idx] = { kind: "tool", text: `${out[idx].text} (err: ${err})` };
        else out.push({ kind: "tool", text: `[${m.toolName ?? "tool"}] (err: ${err})` });
      }
      pendingCalls.delete(id);
    }
  }
  return out;
}

export function digestSession(jsonl: string, budget: number): string {
  let lines = extractLines(jsonl);
  const size = (ls: Line[]): number => ls.reduce((n, l) => n + l.text.length + 1, 0);
  if (size(lines) > budget) lines = lines.filter((l) => l.kind !== "assistant");
  while (size(lines) > budget) {
    const toolIdx = lines.map((l, i) => (l.kind === "tool" ? i : -1)).filter((i) => i >= 0);
    if (!toolIdx.length) break;
    lines.splice(toolIdx[Math.floor(toolIdx.length / 2)], 1);
  }
  return lines.map((l) => l.text).join("\n");
}
