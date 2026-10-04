const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", copy: "©" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, code: string) => {
    if (code[0] !== "#") return entities[code.toLowerCase()] ?? match;
    const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

export const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const removed = "script|style|noscript|svg|nav|header|footer|aside|form|iframe|template|button|select|dialog";

function table(html: string): string {
  const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(([row]) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => stripTags(cell).replaceAll("|", "\\|")));
  const lines = rows.filter((cells) => cells.length).map((cells) => `| ${cells.join(" | ")} |`);
  if (lines.length) lines.splice(1, 0, `|${" --- |".repeat(rows.find((cells) => cells.length)!.length)}`);
  return `\n\n${lines.join("\n")}\n\n`;
}

// A regex converter, not a parser: it handles ordinary article and documentation markup and nothing that needs JavaScript.
export function htmlToMarkdown(html: string, baseUrl: string): { title: string; markdown: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const kept: string[] = [];
  const keep = (text: string): string => `\u0000${kept.push(text) - 1}\u0000`;
  const link = (href: string): string | undefined => {
    try {
      const url = new URL(decodeEntities(href), baseUrl);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  };

  let body = html.replace(/<!--[\s\S]*?-->/g, "").replace(new RegExp(`<(${removed})\\b[\\s\\S]*?</\\1>`, "gi"), "");
  body = /<main\b[\s\S]*<\/main>/i.exec(body)?.[0] ?? /<article\b[\s\S]*<\/article>/i.exec(body)?.[0] ?? /<body\b[\s\S]*<\/body>/i.exec(body)?.[0] ?? body;

  const markdown = body
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, code: string) => {
      const language = /class="[^"]*\blanguage-([\w+-]+)/i.exec(code)?.[1] ?? "";
      return keep(`\n\n\`\`\`${language}\n${decodeEntities(code.replace(/<[^>]+>/g, "")).replace(/\n+$/, "")}\n\`\`\`\n\n`);
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, code: string) => keep(`\`${decodeEntities(code.replace(/<[^>]+>/g, ""))}\``))
    .replace(/<table\b[\s\S]*?<\/table>/gi, (match) => keep(table(match)))
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, text: string) => `\n\n${"#".repeat(Number(level))} ${stripTags(text)}\n\n`)
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const url = link(href);
      return !label ? "" : url && !href.startsWith("#") ? `[${label}](${keep(url)})` : label;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|ul|ol|blockquote|figure|details|summary|dl|dt|dd|hr)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  const text = decodeEntities(markdown)
    .replace(/[ \t\r\f]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => kept[Number(index)])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, markdown: text };
}
