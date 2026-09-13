import { readMetricSeries } from "./metrics.ts";
import { listResults } from "./runner.ts";
import type { Outcome, Proposal } from "./proposals.ts";
import { listSessionFiles, readUserMessages } from "./sessions.ts";

const MIN_SAMPLES = 10;
const THRESHOLD = 0.25;

export function outcomeFor(input: { before: number; after: number; direction: "down" | "up"; samples: number }): Outcome {
  if (input.samples < MIN_SAMPLES) return "insufficient-data";
  const base = input.before === 0 ? 1 : Math.abs(input.before);
  const delta = (input.after - input.before) / base;
  const wanted = input.direction === "down" ? -delta : delta;
  if (wanted >= THRESHOLD) return "improved";
  if (wanted <= -THRESHOLD) return "worse";
  return "unchanged";
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function checkProposal(
  p: Proposal,
  deps: { sessionsDir: string; dbPath: string; evalDir: string },
): { outcome: Outcome; before: number; after: number; samples: number } {
  const appliedAt = p.appliedAt ?? p.createdAt;
  if (!p.verify) return { outcome: "insufficient-data", before: 0, after: 0, samples: 0 };
  if (p.verify.kind === "eval") {
    const latest = listResults(deps.evalDir, { name: p.verify.case, since: appliedAt })[0];
    if (!latest) return { outcome: "insufficient-data", before: p.verify.baseline ?? 0, after: 0, samples: 0 };
    const before = p.verify.baseline ?? latest.baselineScore;
    const runs = latest.arms.with?.length ?? 0;
    if (before === undefined) {
      return { outcome: latest.score >= 1 ? "improved" : "worse", before: 0, after: latest.score, samples: runs };
    }
    const delta = latest.score - before;
    const outcome: Outcome = delta >= THRESHOLD ? "improved" : delta <= -THRESHOLD ? "worse" : "unchanged";
    return { outcome, before, after: latest.score, samples: runs };
  }
  if (p.verify.kind === "correction") {
    const re = new RegExp(p.verify.pattern, "i");
    const count = (path: string): number => readUserMessages(path).filter((t) => re.test(t)).length;
    const afterFiles = listSessionFiles(deps.sessionsDir, { since: appliedAt });
    const beforeFiles = listSessionFiles(deps.sessionsDir, { before: appliedAt, limit: 20 });
    const before = mean(beforeFiles.map((f) => count(f.path)));
    const after = mean(afterFiles.map((f) => count(f.path)));
    return {
      outcome: outcomeFor({ before, after, direction: "down", samples: afterFiles.length }),
      before,
      after,
      samples: afterFiles.length,
    };
  }
  const series = readMetricSeries(deps.dbPath, p.verify.metric, { since: appliedAt });
  const after = mean(series);
  return {
    outcome: outcomeFor({ before: p.verify.baseline, after, direction: p.verify.direction, samples: series.length }),
    before: p.verify.baseline,
    after,
    samples: series.length,
  };
}
