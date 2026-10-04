import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const defaultResults = 8;
const maxResults = 20;

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
const failure = (subject: string, error: unknown): string => `${subject}: ${error instanceof Error ? error.message : String(error)}`;

// Search and fetch code is imported on first use, so loading this extension costs almost nothing at startup.
export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web search",
    description: "Search the web with DuckDuckGo. Returns a title, URL, and snippet for each result. Pass several queries to search different angles at once. Use fetch_content to read a result.",
    parameters: Type.Object({
      queries: Type.Array(Type.String(), { minItems: 1, description: "One or more search queries." }),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: maxResults, description: `Results per query. Default ${defaultResults}.` })),
    }),
    async execute(_id, params, signal) {
      const { search } = await import("./search.js");
      const sections = await Promise.all(
        params.queries.map(async (query) => {
          try {
            const results = await search(query, params.numResults ?? defaultResults, signal);
            const lines = results.map((result, index) => `${index + 1}. [${result.title}](${result.url})\n   ${result.snippet}`);
            return `## ${query}\n\n${lines.join("\n") || "No results."}`;
          } catch (error) {
            return `## ${query}\n\n${failure("Search failed", error)}`;
          }
        }),
      );
      return text(sections.join("\n\n"));
    },
  });

  pi.registerTool({
    name: "fetch_content",
    label: "Fetch content",
    description: "Fetch one or more web pages and return them as Markdown. GitHub repository, file, issue, and pull request URLs are supported. Long pages are truncated: pass offset to continue reading from a line number.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "A single URL." })),
      urls: Type.Optional(Type.Array(Type.String(), { description: "Several URLs to fetch at once." })),
      offset: Type.Optional(Type.Integer({ minimum: 1, description: "Line number to start from when continuing a truncated page." })),
    }),
    async execute(_id, params, signal) {
      const urls = [...(params.url ? [params.url] : []), ...(params.urls ?? [])];
      if (!urls.length) throw new Error("Pass url or urls.");
      const { fetchPage } = await import("./fetch.js");
      const start = (params.offset ?? 1) - 1;
      const limits = { maxLines: Math.floor(DEFAULT_MAX_LINES / urls.length), maxBytes: Math.floor(DEFAULT_MAX_BYTES / urls.length) };
      const sections = await Promise.all(
        urls.map(async (url) => {
          try {
            const page = await fetchPage(url, signal);
            const lines = page.text.split("\n");
            const part = truncateHead(lines.slice(start).join("\n"), limits);
            const end = start + part.outputLines;
            const note = end < lines.length ? `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Call fetch_content with this url and offset ${end + 1} to continue.]` : "";
            return `# ${page.title}\n\nSource: ${page.url}\n\n${part.content}${note}`;
          } catch (error) {
            return failure(`Could not fetch ${url}`, error);
          }
        }),
      );
      return text(sections.join("\n\n---\n\n"));
    },
  });
}
