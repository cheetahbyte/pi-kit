# Pi web

`@cheetahbyte/pi-web` gives the agent two tools: `web_search` and `fetch_content`. It needs no API key and has no runtime dependencies. The search and fetch code loads on first use, so the extension adds almost nothing to Pi's startup time.

## Install

```sh
pi install npm:@cheetahbyte/pi-web
```

This package is part of [Pi kit](https://github.com/cheetahbyte/pi-kit). If you install the kit, don't install this package separately.

Don't also load another extension that registers `web_search` or `fetch_content`, such as `pi-web-access`.

## Search the web

`web_search` queries DuckDuckGo and returns a title, URL, and snippet for each result.

| Field | Description |
| --- | --- |
| `queries` | One or more search queries. They run in parallel. |
| `numResults` | Results for each query, from 1 to 20. The default is 8. |

DuckDuckGo sometimes answers with a bot check instead of results. The tool then reports that, and the search works again after a short wait.

## Fetch pages

`fetch_content` downloads pages and converts them to Markdown.

| Field | Description |
| --- | --- |
| `url` | A single URL. |
| `urls` | Several URLs. They are fetched in parallel. |
| `offset` | The line number to start from when you continue a truncated page. |

Long pages are truncated to Pi's tool output limits, which are shared between the URLs of one call. The output then ends with the line number to pass as `offset`. Fetched pages are kept in memory, so continuing a page doesn't download it again.

GitHub URLs are read from GitHub's raw and API endpoints:

| URL | Content |
| --- | --- |
| A repository | Its `README.md`. |
| A file under `/blob/` | The file. |
| An issue or pull request | The title, state, description, and comments. |

Set `GITHUB_TOKEN` to raise GitHub's API rate limit or to read private repositories.

## Limits

- Pages that need JavaScript to render return little or no text.
- The Markdown converter handles ordinary article and documentation pages. Unusual layouts can leave stray list markers or lose structure.
- PDFs, images, and video aren't supported.
- A page larger than 5 MB is rejected.
