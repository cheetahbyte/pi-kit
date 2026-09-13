import { runAudit, runEvals, runRetro } from "./worker.ts";

const [mode, ...rest] = process.argv.slice(2);

if (mode === "retro") {
  const [sessionFile = "", sessionId = "", reasons = ""] = rest;
  await runRetro(sessionFile, sessionId, reasons.split(",").filter(Boolean));
} else if (mode === "audit") {
  await runAudit(Number(rest[0]) || 30);
} else if (mode === "run") {
  await runEvals(rest[0] || undefined);
}
process.exit(0);
