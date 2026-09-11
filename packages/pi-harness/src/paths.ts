import { homedir } from "node:os";
import { join } from "node:path";

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

export function harnessDir(): string {
  return join(agentDir(), "harness");
}

export function sessionsDir(): string {
  return join(agentDir(), "sessions");
}

export function efficiencyDbPath(): string {
  return process.env.PI_EFFICIENCY_DB ?? join(agentDir(), "efficiency.db");
}
