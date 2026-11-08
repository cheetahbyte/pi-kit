import { createWriteStream, mkdtempSync, rmSync, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

export type JobStatus = "running" | "exited" | "killed" | "failed";

export type Job = {
  id: string;
  command: string;
  description?: string;
  cwd: string;
  logPath: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  status: JobStatus;
  error?: string;
};

type Entry = Job & { tail: string; log: WriteStream; controller: AbortController };

// Enough for the last few hundred lines; the full output stays in the log file.
const TAIL_BYTES = 256 * 1024;

export class Jobs {
  private readonly entries = new Map<string, Entry>();
  private readonly bash = createLocalBashOperations();
  private dir: string | undefined;
  private next = 1;

  constructor(
    private readonly onExit: (job: Job, tail: string) => void,
    private readonly onChange: () => void,
  ) {}

  start(command: string, cwd: string, description?: string): Job {
    this.dir ??= mkdtempSync(join(tmpdir(), "pi-background-shell-"));
    const id = `bg-${this.next++}`;
    const logPath = join(this.dir, `${id}.log`);
    const entry: Entry = {
      id, command, description, cwd, logPath,
      startedAt: Date.now(),
      status: "running",
      tail: "",
      log: createWriteStream(logPath),
      controller: new AbortController(),
    };
    this.entries.set(id, entry);
    this.onChange();

    this.bash
      .exec(command, cwd, {
        signal: entry.controller.signal,
        onData: (data) => {
          entry.log.write(data);
          entry.tail = (entry.tail + data.toString("utf8")).slice(-TAIL_BYTES);
        },
      })
      .then(({ exitCode }) => this.finish(entry, entry.controller.signal.aborted ? "killed" : "exited", exitCode))
      .catch((error: unknown) => {
        if (entry.controller.signal.aborted) this.finish(entry, "killed", null);
        else this.finish(entry, "failed", null, error instanceof Error ? error.message : String(error));
      });

    return snapshot(entry);
  }

  get(id: string): { job: Job; tail: string } | undefined {
    const entry = this.entries.get(id);
    return entry && { job: snapshot(entry), tail: entry.tail };
  }

  list(): Job[] {
    return [...this.entries.values()].map(snapshot);
  }

  running(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.status === "running") count++;
    return count;
  }

  kill(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== "running") return false;
    entry.controller.abort();
    return true;
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.status === "running") entry.controller.abort();
      entry.log.end();
    }
    this.entries.clear();
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = undefined;
  }

  private finish(entry: Entry, status: JobStatus, exitCode: number | null, error?: string): void {
    if (entry.status !== "running") return;
    Object.assign(entry, { status, exitCode, error, endedAt: Date.now() });
    entry.log.end();
    this.onChange();
    if (status !== "killed") this.onExit(snapshot(entry), entry.tail);
  }
}

const snapshot = ({ tail: _tail, log: _log, controller: _controller, ...job }: Entry): Job => ({ ...job });

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function describe(job: Job, now = Date.now()): string {
  const duration = formatDuration((job.endedAt ?? now) - job.startedAt);
  if (job.status === "running") return `running for ${duration}`;
  if (job.status === "killed") return `killed after ${duration}`;
  if (job.status === "failed") return `failed to run after ${duration}: ${job.error ?? "unknown error"}`;
  return `exited with code ${job.exitCode ?? "unknown"} after ${duration}`;
}
