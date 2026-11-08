import { DEFAULT_MAX_BYTES, truncateTail, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { int, obj, opt, str, type Static } from "@earendil-works/pi-schema";
import { Box, Text } from "@earendil-works/pi-tui";
import { describe, Jobs, type Job } from "./jobs.ts";

const MESSAGE_TYPE = "background-shell";
const FOOTER_WIDGET = "background_shell";
const EXIT_TAIL_LINES = 40;
const DEFAULT_OUTPUT_LINES = 200;

const startParameters = obj({
  command: str({ description: "Bash command to run in the background." }),
  description: opt(str({ description: "Short label for the job, shown in /bg and the exit notice." })),
});
const outputParameters = obj({
  id: str({ description: "Job id returned by bash_background, for example bg-1." }),
  lines: opt(int({ minimum: 1, description: `Lines from the end of the output. Default ${DEFAULT_OUTPUT_LINES}.` })),
});
const killParameters = obj({
  id: str({ description: "Job id returned by bash_background." }),
});

type ExitDetails = { job: Job; tail: string };

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
const tailOf = (output: string, maxLines: number) => truncateTail(output.trimEnd(), { maxLines, maxBytes: DEFAULT_MAX_BYTES }).content;
const label = (job: Job) => job.description ?? job.command;

export default function (pi: ExtensionAPI): void {
  const publish = () => {
    const running = jobs.running();
    pi.events.emit("pi-footer:update-widget", { widgetId: FOOTER_WIDGET, value: running ? `${running} running` : null });
  };

  const jobs = new Jobs((job, tail) => {
    const output = tailOf(tail, EXIT_TAIL_LINES);
    pi.sendMessage<ExitDetails>(
      {
        customType: MESSAGE_TYPE,
        content: [
          `Background job ${job.id} (\`${job.command}\`) ${describe(job)}.`,
          output ? `Last output:\n\`\`\`\n${output}\n\`\`\`` : "It printed no output.",
          `Full log: ${job.logPath}`,
        ].join("\n\n"),
        display: true,
        details: { job, tail: output },
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }, () => publish());

  pi.registerTool({
    name: "bash_background",
    label: "Background bash",
    description:
      "Start a bash command in the background and return its job id at once. When the command exits, a message with its exit code and last output arrives in the conversation. Use for test suites, builds, full checks, and servers.",
    promptSnippet: "Run long bash commands in the background (tests, builds, servers)",
    promptGuidelines: [
      "Use bash_background for commands likely to take longer than about 30 seconds, such as full test suites, builds, or `bun run check`, and for servers that never exit; keep working while they run.",
      "After starting a bash_background job, continue with other work or end your turn: its exit message arrives on its own. Call bash_output only when you need output before the job exits.",
    ],
    parameters: startParameters,
    async execute(_id, params: Static<typeof startParameters>, _signal, _onUpdate, ctx) {
      const job = jobs.start(params.command, ctx.cwd, params.description);
      return text(`Started ${job.id} in ${job.cwd}. Its exit message will arrive in the conversation. Log: ${job.logPath}`);
    },
  });

  pi.registerTool({
    name: "bash_output",
    label: "Background output",
    description: "Read the status and latest output of a background job started with bash_background.",
    parameters: outputParameters,
    async execute(_id, params: Static<typeof outputParameters>) {
      const found = jobs.get(params.id);
      if (!found) throw new Error(`No background job ${params.id}. Jobs: ${jobs.list().map((job) => job.id).join(", ") || "none"}.`);
      const output = tailOf(found.tail, params.lines ?? DEFAULT_OUTPUT_LINES);
      return text(`${found.job.id} (\`${found.job.command}\`) ${describe(found.job)}.\n\n${output || "(no output yet)"}\n\nFull log: ${found.job.logPath}`);
    },
  });

  pi.registerTool({
    name: "bash_kill",
    label: "Kill background job",
    description: "Stop a running background job started with bash_background, including its child processes.",
    parameters: killParameters,
    async execute(_id, params: Static<typeof killParameters>) {
      if (!jobs.kill(params.id)) throw new Error(`${params.id} is not a running background job.`);
      return text(`Stopped ${params.id}.`);
    },
  });

  pi.registerCommand("bg", {
    description: "List background jobs, or stop one with /bg kill <id>",
    handler: async (args, ctx) => {
      const [action, id] = args.trim().split(/\s+/);
      if (action === "kill") {
        if (id && jobs.kill(id)) return ctx.ui.notify(`Stopped ${id}.`, "info");
        return ctx.ui.notify(`${id ?? "That job"} is not a running background job.`, "error");
      }
      const list = jobs.list();
      if (!list.length) return ctx.ui.notify("No background jobs.", "info");
      ctx.ui.notify(["Background jobs", ...list.map((job) => `${job.id}  ${label(job)}  ${describe(job)}`)].join("\n"), "info");
    },
  });

  pi.registerMessageRenderer<ExitDetails>(MESSAGE_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details;
    if (!details) return undefined;
    const { job, tail } = details;
    const ok = job.status === "exited" && job.exitCode === 0;
    const icon = theme.fg(ok ? "success" : "error", ok ? "✓" : "✗");
    const header = `${icon} ${theme.fg("accent", job.id)} ${theme.bold(label(job))} ${theme.fg("dim", describe(job))}`;
    const body = expanded ? `\n${theme.fg("muted", tail || "(no output)")}\n${theme.fg("dim", job.logPath)}` : "";
    const box = new Box(outputPad, 1, (line) => theme.bg("customMessageBg", line));
    box.addChild(new Text(header + body, 0, 0));
    return box;
  });

  pi.on("session_start", () => publish());
  pi.on("session_shutdown", () => {
    jobs.dispose();
    publish();
  });
}
