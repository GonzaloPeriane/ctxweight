#!/usr/bin/env node
import { parseArgs } from "node:util";
import { promises as fs } from "node:fs";
import { runHealth } from "./commands/health.js";
import { runBudget } from "./commands/budget.js";
import { printTerminal } from "./report/terminal.js";
import { renderMarkdown } from "./report/markdown.js";
import { toSarif } from "./report/sarif.js";
import type { BudgetReport, Finding, HealthReport, Severity } from "./core/types.js";

const REPORT_FILE = "ctxweight-report.md";

const HELP = `ctxweight — X-ray your AI agent's context (health + token cost).

Usage:
  ctxweight [path]                 run health + budget (default: .)
  ctxweight health [path]          context quality checks only
  ctxweight budget [path]          token cost breakdown only

Options:
  --model <name>   pricing model for cost estimate (claude-opus, claude-sonnet, ...)
  --mcp <file>     path to an MCP config to include tool-schema token cost
  --json           machine-readable JSON to stdout
  --sarif          SARIF 2.1.0 to stdout (health findings; for GitHub code scanning)
  --md             write a Markdown report to ${REPORT_FILE}
  --full           terminal output: list every entry/finding (default shows top 8)
  --fail-on <list> exit 1 if HEALTH findings match (CI gate). <list> is comma-
                   separated; each item is a severity (error|warn|info — fails
                   at that level or higher) or a finding code (e.g. secrets/aws-key)
  -h, --help       show this help

--json, --sarif and --md are mutually exclusive on stdout; precedence is
sarif > json > md > terminal. --md always writes ${REPORT_FILE}, so it can
be combined with another stdout format.
`;

function emptyHealth(): HealthReport {
  return { files: [], findings: [], score: null, grade: "N/A", noContext: false };
}

// error > warn > info. A severity threshold matches that level and anything above.
const SEVERITY_RANK: Record<Severity, number> = { info: 1, warn: 2, error: 3 };
const SEVERITY_NAMES = new Set<Severity>(["info", "warn", "error"]);

/**
 * Evaluate a `--fail-on` spec against health findings. Each comma-separated item
 * is a severity (fail at that level or higher) or an exact finding code.
 */
function evaluateFailOn(findings: Finding[], spec: string) {
  const items = spec.split(",").map((t) => t.trim()).filter(Boolean);
  const severities = items.filter((t): t is Severity => SEVERITY_NAMES.has(t as Severity));
  const codes = items.filter((t) => !SEVERITY_NAMES.has(t as Severity));

  // Lowest requested severity wins (it admits the most findings).
  const minRank = severities.length ? Math.min(...severities.map((s) => SEVERITY_RANK[s])) : Infinity;
  const lowestSev = (Object.keys(SEVERITY_RANK) as Severity[]).find((s) => SEVERITY_RANK[s] === minRank);

  const codeSet = new Set(codes);
  const sevMatches = findings.filter((f) => SEVERITY_RANK[f.severity] >= minRank);
  const codeMatches = findings.filter((f) => codeSet.has(f.code));
  const matched = findings.filter((f) => SEVERITY_RANK[f.severity] >= minRank || codeSet.has(f.code));

  return { matched, sevMatches, codeMatches, lowestSev, codes };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string" },
      mcp: { type: "string" },
      json: { type: "boolean", default: false },
      sarif: { type: "boolean", default: false },
      md: { type: "boolean", default: false },
      full: { type: "boolean", default: false },
      "fail-on": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  // First positional may be a command or a path.
  const known = new Set(["health", "budget"]);
  let command = "all";
  let path = ".";
  if (positionals[0] && known.has(positionals[0])) {
    command = positionals[0];
    path = positionals[1] ?? ".";
  } else if (positionals[0]) {
    path = positionals[0];
  }

  const wantSarif = values.sarif as boolean;
  const wantJson = values.json as boolean;
  const wantMd = values.md as boolean;

  // Stdout formats are mutually exclusive; warn if combined. (--md also writes
  // a file, so it coexists — but only one thing is printed to stdout.)
  const combo = [wantSarif && "--sarif", wantJson && "--json", wantMd && "--md"].filter(Boolean);
  if (combo.length > 1) {
    const winner = wantSarif ? "--sarif" : "--json"; // --md never wins stdout when >1 requested
    const mdNote = wantMd ? ` --md still writes ${REPORT_FILE}.` : "";
    console.error(
      `ctxweight: multiple stdout formats requested (${combo.join(", ")}); ` +
        `using ${winner} (precedence: sarif > json > md > terminal).${mdNote}`,
    );
  }

  let healthReport: HealthReport | undefined;
  let budgetReport: BudgetReport | undefined;
  if (command === "health" || command === "all") {
    healthReport = await runHealth(path);
  }
  if (command === "budget" || command === "all") {
    budgetReport = await runBudget(path, { model: values.model, mcp: values.mcp });
  }

  // --md writes the report file regardless of the stdout format (coexists).
  if (wantMd) {
    const md = renderMarkdown({ health: healthReport, budget: budgetReport });
    await fs.writeFile(REPORT_FILE, md, "utf8");
  }

  // A single stdout format wins by precedence: sarif > json > md(notice) > terminal.
  if (wantSarif) {
    console.log(JSON.stringify(toSarif(healthReport ?? emptyHealth()), null, 2));
  } else if (wantJson) {
    const payload =
      healthReport && budgetReport
        ? { health: healthReport, budget: budgetReport }
        : (healthReport ?? budgetReport);
    console.log(JSON.stringify(payload, null, 2));
  } else if (wantMd) {
    console.log(`→ wrote ${REPORT_FILE}`);
  } else {
    printTerminal(healthReport, budgetReport, { full: values.full as boolean });
  }

  // CI gate — evaluated AFTER the report is emitted so a failing step can still
  // upload its SARIF/Markdown artifact. Uses process.exitCode (not exit()) so
  // stdout flushes fully before the process ends. Applies to HEALTH findings only.
  //
  // A no-context repo has zero findings, so --fail-on never trips on it by itself
  // (exit 0). TODO(claude): add a `--require-context` flag for teams that want a
  // missing CLAUDE.md/AGENTS.md to fail CI (exit 1) — off by default.
  const failOn = values["fail-on"] as string | undefined;
  if (failOn) {
    const res = evaluateFailOn(healthReport?.findings ?? [], failOn);
    if (res.matched.length > 0) {
      const reasons: string[] = [];
      if (res.lowestSev) reasons.push(`${res.sevMatches.length} at or above severity "${res.lowestSev}"`);
      if (res.codes.length) reasons.push(`${res.codeMatches.length} matching code(s): ${res.codes.join(", ")}`);
      console.error(
        `ctxweight: --fail-on triggered — ${res.matched.length} health finding(s) matched (${reasons.join("; ")}).`,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("ctxweight error:", err?.message ?? err);
  process.exit(1);
});
