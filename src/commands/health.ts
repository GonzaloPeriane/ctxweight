import { discover } from "../core/discover.js";
import { scanSecrets } from "../core/secrets.js";
import { suggestOverTruncation, suggestTooLong, suggestUnresolvedImport } from "../core/suggest.js";
import type { Finding, HealthReport, Severity } from "../core/types.js";

// Budget thresholds. Short files follow instructions more reliably;
// Codex hard-truncates AGENTS.md past 32 KiB.
const MAX_LINES = 200;
const MAX_BYTES = 32 * 1024;

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export async function runHealth(root: string): Promise<HealthReport> {
  const files = await discover(root);

  // No agent-context files = nothing to audit. This is N/A, not a perfect score:
  // grading an absent context 100/A would be misleading for an auditing tool.
  if (files.length === 0) {
    return { files, findings: [], score: null, grade: "N/A", noContext: true };
  }

  const findings: Finding[] = [];

  for (const f of files) {
    // 1) Budget / length. Always-on files hurt every turn (warn); on-demand
    //    files (skills, rules) only cost tokens when invoked, so a long one is
    //    info, not a real problem — it must not sink the grade.
    const budgetSeverity: Severity = f.load === "always" ? "warn" : "info";
    const onDemandHint =
      f.load === "ondemand" ? " — on-demand, so it only costs tokens when invoked, not every turn" : "";
    if (f.lines > MAX_LINES) {
      findings.push({
        severity: budgetSeverity,
        code: "budget/too-long",
        message: `${f.relPath} is ${f.lines} lines (recommended <= ${MAX_LINES}); tail may be ignored ("lost in the middle")${onDemandHint}.`,
        suggestion: suggestTooLong(f),
        file: f.relPath,
      });
    }
    if (f.bytes > MAX_BYTES) {
      findings.push({
        severity: budgetSeverity,
        code: "budget/over-truncation-limit",
        message: `${f.relPath} is ${(f.bytes / 1024).toFixed(1)} KiB; some agents truncate past 32 KiB${onDemandHint}.`,
        suggestion: suggestOverTruncation(f),
        file: f.relPath,
      });
    }

    // 2) Secrets / PII.
    findings.push(...scanSecrets(f));

    // 3) Broken @import references — info, so a typo'd import doesn't tank the score.
    for (const spec of f.unresolvedImports) {
      findings.push({
        severity: "info",
        code: "imports/unresolved",
        message: `${f.relPath} imports "@${spec}" which could not be resolved (file missing or unreadable).`,
        suggestion: suggestUnresolvedImport(),
        file: f.relPath,
      });
    }

    // TODO(claude): 3) redundancy — flag rules duplicated from README.md
    //   or repeated across context files (tokenize + cosine / shingle match).
    // TODO(claude): 4) drift — same rule present in one context file but
    //   missing or reworded in another (pair CLAUDE.md <-> AGENTS.md).
    // TODO(claude): 5) linter-overlap — rules a formatter already enforces.
  }

  // Simple scoring: start at 100, subtract per finding by severity.
  let score = 100;
  for (const x of findings) {
    score -= x.severity === "error" ? 25 : x.severity === "warn" ? 8 : 2;
  }
  score = Math.max(0, score);

  return { files, findings, score, grade: gradeFor(score), noContext: false };
}
