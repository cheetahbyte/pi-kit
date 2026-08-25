import { basename, extname } from "node:path";
import { VERSION, type ExtensionAPI, type SourceInfo } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const LOGO = [
  "████████████",
  "   ███  ███ ",
  "   ███  ███ ",
  "   ███  ███ ",
  "  ███   ███ ",
];

function center(text: string, width: number): string {
  return " ".repeat(Math.max(0, Math.floor((width - visibleWidth(text)) / 2))) + text;
}

function row(
  label: string,
  values: string[],
  width: number,
  labelColor: (text: string) => string,
  contentColor: (text: string) => string,
): string[] {
  if (!values.length) return [];

  const prefix = `[${label}]`.padEnd(14);
  const indent = " ".repeat(prefix.length);
  const lines: string[] = [];
  let line = prefix;

  for (const value of values) {
    const next = `${line}${line.trimEnd() === prefix.trimEnd() ? "" : ", "}${value}`;
    if (visibleWidth(next) <= width || line === prefix) line = next;
    else {
      lines.push(line);
      line = `${indent}${value}`;
    }
  }

  lines.push(line);
  return lines.map((text) => {
    const truncated = truncateToWidth(text, width, "");
    return labelColor(truncated.slice(0, prefix.length)) + contentColor(truncated.slice(prefix.length));
  });
}

function extensionName({ path, source }: SourceInfo): string {
  if (source !== "local") return source;
  const name = basename(path);
  return name.startsWith("index.") ? basename(path.slice(0, -(name.length + 1))) : basename(name, extname(name));
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const commands = pi.getCommands();
    const prompts = commands.filter(({ source }) => source === "prompt").map(({ name }) => name);
    const skills = commands.filter(({ source }) => source === "skill").map(({ name }) => name.replace(/^skill:/, ""));
    const extensions = [...new Set([
      "pi-header",
      ...commands.filter(({ source }) => source === "extension").map(({ sourceInfo }) => extensionName(sourceInfo)),
      ...pi.getAllTools()
        .filter(({ sourceInfo }) => !["builtin", "sdk"].includes(sourceInfo.source))
        .map(({ sourceInfo }) => extensionName(sourceInfo)),
    ])].sort();
    const context = [ctx.cwd.split("/").pop() || ctx.cwd];

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        const logo = LOGO.map((line) => center(theme.bold(line), width));
        const version = center(`pi v${VERSION}`, width);

        return [
          "",
          ...logo.map((line) => theme.fg("text", line)),
          theme.fg("dim", version),
          "",
          ...row("Context", context, width, (text) => theme.fg("dim", text), (text) => theme.fg("text", text)),
          ...row("Prompts", prompts, width, (text) => theme.fg("dim", text), (text) => theme.fg("text", text)),
          ...row("Skills", skills, width, (text) => theme.fg("dim", text), (text) => theme.fg("text", text)),
          ...row("Extensions", extensions, width, (text) => theme.fg("dim", text), (text) => theme.fg("text", text)),
          "",
        ];
      },
      invalidate() {},
    }));
  });

  pi.registerCommand("builtin-header", {
    description: "Restore Pi's built-in header",
    handler: async (_args, ctx) => ctx.ui.setHeader(undefined),
  });
}
