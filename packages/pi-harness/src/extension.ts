import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type HarnessConfig } from "./config.ts";
import { newSignals, recordToolResult, recordUserText, shouldFlag, type SessionSignals } from "./flag.ts";
import { agentDir, efficiencyDbPath, harnessDir, sessionsDir } from "./paths.ts";
import { listProposals } from "./proposals.ts";
import { checkAll, reviewLoop, type Deps } from "./review.ts";
import { lastWorkerError, spawnWorker } from "./worker.ts";

export default function harnessExtension(pi: ExtensionAPI): void {
  if (process.env.PI_HARNESS_WORKER === "1") return;

  const deps: Deps = {
    agentDir: agentDir(),
    harnessDir: harnessDir(),
    sessionsDir: sessionsDir(),
    dbPath: efficiencyDbPath(),
  };
  let cfg: HarnessConfig = loadConfig(deps.harnessDir);
  let signals: SessionSignals = newSignals();
  let sessionFile: string | undefined;
  let sessionId = "";

  pi.on("session_start", async (_event, ctx) => {
    cfg = loadConfig(deps.harnessDir);
    signals = newSignals();
    sessionFile = ctx.sessionManager.getSessionFile();
    sessionId = ctx.sessionManager.getSessionId();
    if (!ctx.hasUI) return;
    const pending = listProposals(deps.harnessDir, "pending").length;
    if (pending > 0) {
      ctx.ui.notify(`harness: ${pending} proposal${pending === 1 ? "" : "s"} pending, run /harness`, "info");
    }
    const err = lastWorkerError();
    if (err) ctx.ui.notify(`harness: last worker failed: ${err.slice(0, 120)}`, "warning");
  });

  pi.on("input", async (event) => {
    if (event.source !== "interactive" || event.text.startsWith("/")) return;
    recordUserText(signals, event.text, cfg.correctionPatterns);
  });

  pi.on("tool_result", async (event) => {
    const text = Array.isArray(event.content)
      ? event.content.map((c) => (c as { text?: string }).text ?? "").join(" ")
      : String(event.content ?? "");
    recordToolResult(signals, event.toolName, Boolean(event.isError), text);
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason !== "quit" && event.reason !== "new") return;
    if (!cfg.auto || !sessionFile || !sessionId) return;
    const r = shouldFlag(signals, cfg);
    if (!r.flagged) return;
    spawnWorker("retro", [sessionFile, sessionId, r.reasons.join(",")]);
  });

  pi.registerCommand("harness", {
    description: "Review harness proposals; subcommands: check, audit [n], retro",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const [sub = "", arg] = args.trim().split(/\s+/);
      if (sub === "check") return checkAll(ctx, deps);
      if (sub === "audit") {
        spawnWorker("audit", [String(Number(arg) || cfg.auditSessions)]);
        ctx.ui.notify("harness: audit started in background", "info");
        return;
      }
      if (sub === "retro") {
        if (!sessionFile) {
          ctx.ui.notify("harness: no session file", "warning");
          return;
        }
        spawnWorker("retro", [sessionFile, sessionId, "manual"]);
        ctx.ui.notify("harness: retrospective started in background", "info");
        return;
      }
      await reviewLoop(ctx, deps, () => spawnWorker("audit", [String(cfg.auditSessions)]));
    },
  });
}
