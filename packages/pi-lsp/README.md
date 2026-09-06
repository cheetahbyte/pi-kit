# pi-lsp

Code navigation tools backed by a language server.

## Tools

| Tool | Params | Result |
| --- | --- | --- |
| `outline` | `path` | Symbol tree of the file with line ranges |
| `references` | `symbol`, `path?`, `includeDeclaration?` | Every reference, one `file:line:col` per line plus the source line |
| `definition` | `symbol`, `path?` | Where the symbol is defined |
| `read_symbol` | `path`, `name`, `maxLines?` | Source of one symbol, numbered, capped at 200 lines by default |

`references` and `definition` resolve the name through `workspace/symbol`. Matching is
on the last name segment and ignores signatures, so `area` finds a method a server
reports as `Shape.Area` or as `area()`.
When several distinct symbols match, the call fails and lists them; narrow it with
`path` or a qualified `Container.name`.

`read_symbol` resolves through the file's own outline instead, so it needs no
workspace indexing.

## Servers

Chosen by file extension, first one found on `PATH`:

| Extensions | Command |
| --- | --- |
| `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | `typescript-language-server --stdio` |
| `.py .pyi` | `pyright-langserver --stdio`, else `pylsp` |
| `.rs` | `rust-analyzer` |
| `.go` | `gopls` |
| `.swift` | `sourcekit-lsp` (SwiftPM roots; Xcode projects need `buildServer.json`) |
| `.c .h .cc .cpp .hpp .cxx .hh` | `clangd` |
| `.lua` | `lua-language-server` |

One server process per (server, project root); roots come from markers such as
`go.mod`, `Cargo.toml`, `tsconfig.json`, falling back to `.git`. Processes are killed
on session shutdown.

Add or override servers in `.pi/lsp.json` under the working directory:

```json
{
  "servers": [
    {
      "id": "deno",
      "command": "deno",
      "args": ["lsp"],
      "extensions": [".ts", ".tsx"],
      "rootMarkers": ["deno.json"],
      "languageIds": { ".ts": "typescript" },
      "initializationOptions": { "enable": true }
    }
  ]
}
```

Entries there are tried before the built-ins. `PI_LSP_TIMEOUT_MS` sets the per-request
timeout (default 30000).
