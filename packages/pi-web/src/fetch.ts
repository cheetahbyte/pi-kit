import { htmlToMarkdown } from "./markdown.js";
import { userAgent } from "./search.js";

export type Page = { url: string; title: string; text: string };

const timeout = 30_000;
const maxBytes = 5_000_000;
const maxCached = 20;
const cache = new Map<string, Page>();

type Issue = { title: string; state: string; body: string | null; user: { login: string }; comments: number; comments_url: string };
type Comment = { body: string | null; user: { login: string } };

async function request(url: string, accept: string, signal?: AbortSignal): Promise<Response> {
  const token = new URL(url).hostname === "api.github.com" ? process.env.GITHUB_TOKEN : undefined;
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": userAgent, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`${url} returned status ${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error(`${url} is larger than ${maxBytes / 1_000_000} MB`);
  return response;
}

// GitHub pages are mostly rendered by JavaScript, so files and issues are read from the raw and API endpoints.
async function fetchGitHub(url: URL, signal?: AbortSignal): Promise<Page | undefined> {
  const [owner, repo, kind, ...rest] = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "github.com" || !owner || !repo) return undefined;
  const raw = (path: string) => `https://raw.githubusercontent.com/${owner}/${repo}/${path}`;
  if (!kind) return { url: url.href, title: `${owner}/${repo}`, text: await (await request(raw("HEAD/README.md"), "text/plain", signal)).text() };
  if (kind === "blob" && rest.length > 1) return { url: url.href, title: rest.slice(1).join("/"), text: await (await request(raw(rest.join("/")), "text/plain", signal)).text() };
  if ((kind !== "issues" && kind !== "pull") || !/^\d+$/.test(rest[0] ?? "")) return undefined;

  const accept = "application/vnd.github+json";
  const issue = (await (await request(`https://api.github.com/repos/${owner}/${repo}/issues/${rest[0]}`, accept, signal)).json()) as Issue;
  const comments = issue.comments ? ((await (await request(`${issue.comments_url}?per_page=100`, accept, signal)).json()) as Comment[]) : [];
  const text = [`State: ${issue.state}`, `**${issue.user.login}** wrote:\n\n${issue.body ?? ""}`, ...comments.map((comment) => `**${comment.user.login}** commented:\n\n${comment.body ?? ""}`)].join("\n\n---\n\n");
  return { url: url.href, title: issue.title, text };
}

export async function fetchPage(address: string, signal?: AbortSignal): Promise<Page> {
  const url = new URL(address);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${address} is not an http or https URL`);
  const cached = cache.get(url.href);
  if (cached) return cached;

  let page = await fetchGitHub(url, signal);
  if (!page) {
    const response = await request(url.href, "text/markdown, text/html;q=0.9, text/plain;q=0.8, application/json;q=0.7", signal);
    const type = response.headers.get("content-type") ?? "";
    if (!/^(text\/|application\/(json|xml|xhtml\+xml|javascript))/.test(type)) throw new Error(`${address} has unsupported content type ${type || "unknown"}`);
    const body = (await response.text()).slice(0, maxBytes);
    const { title, markdown } = /html/.test(type) ? htmlToMarkdown(body, response.url) : { title: "", markdown: body };
    if (!markdown) throw new Error(`${address} has no readable text. The page probably needs JavaScript to render.`);
    page = { url: response.url, title: title || url.hostname, text: markdown };
  }

  if (cache.size >= maxCached) cache.delete(cache.keys().next().value!);
  cache.set(url.href, page);
  return page;
}
