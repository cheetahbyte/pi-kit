import { decodeEntities, stripTags } from "./markdown.ts";

export type SearchResult = { title: string; url: string; snippet: string };

export const userAgent = "Mozilla/5.0 (compatible; pi-web; +https://github.com/cheetahbyte/pi-kit)";
const endpoint = "https://html.duckduckgo.com/html/";
const timeout = 15_000;

// DuckDuckGo links either point at the page or at a redirect that carries the page in `uddg`.
function resultUrl(href: string): string | undefined {
  try {
    const url = new URL(decodeEntities(href), endpoint);
    const target = url.hostname.endsWith("duckduckgo.com") ? url.searchParams.get("uddg") : url.href;
    return target && /^https?:/.test(target) ? target : undefined;
  } catch {
    return undefined;
  }
}

export function parseResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  for (const block of html.split(/<div class="result /).slice(1)) {
    if (block.startsWith("result--ad") || /^[^"]*\bresult--ad\b/.test(block)) continue;
    const anchor = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const url = anchor && resultUrl(anchor[1]);
    if (!anchor || !url) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "";
    results.push({ title: stripTags(anchor[2]), url, snippet: stripTags(snippet) });
    if (results.length >= limit) break;
  }
  return results;
}

export async function search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`, {
    headers: { Accept: "text/html", "User-Agent": userAgent },
    signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
  });
  if (response.status === 202) throw new Error("DuckDuckGo asked for a bot check instead of returning results. Wait a minute and search again.");
  if (!response.ok) throw new Error(`DuckDuckGo search failed with status ${response.status}`);
  return parseResults(await response.text(), limit);
}
