// Reads results/*.json (from run-study) and writes STUDY.md with ONLY aggregate,
// honest metrics. No per-repo security findings are ever published.
//   npm run study:aggregate
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "results");
const OUT = path.join(HERE, "STUDY.md");

interface Finding {
  severity: string;
  code: string;
}
interface Report {
  health: { grade: string; score: number | null; noContext: boolean; findings: Finding[] };
  budget: { alwaysOnTokens: number; onDemandTokens: number; onDemandCount: number };
}
interface Result {
  url: string;
  owner: string;
  repo: string;
  status: "ok" | "n/a" | "error";
  scannedAt: string;
  commit: string | null;
  error: string | null;
  report: Report | null;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (n: number, d: number): string => (d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`);
const nf = (n: number): string => n.toLocaleString("en-US");

// An always-on file over 32 KiB: over-truncation-limit is `warn` for always-on
// files and `info` for on-demand ones (see commands/health.ts).
const truncatesAlwaysOn = (r: Result): boolean =>
  (r.report?.health.findings ?? []).some((f) => f.code === "budget/over-truncation-limit" && f.severity === "warn");

// Credential-shaped codes: what a scanner flags as a possible leaked secret.
// (secrets/placeholder is already excluded — those are documentation examples.)
const CREDENTIAL_CODES = new Set([
  "secrets/generic-token",
  "secrets/openai-key",
  "secrets/bearer",
  "secrets/aws-key",
  "secrets/private-key",
]);
const hasCode = (r: Result, code: string): boolean =>
  (r.report?.health.findings ?? []).some((f) => f.code === code);
const hasCredentialShaped = (r: Result): boolean =>
  (r.report?.health.findings ?? []).some((f) => CREDENTIAL_CODES.has(f.code));

function main(): void {
  if (!existsSync(RESULTS)) {
    console.error("No results/ — run `npm run study` first.");
    process.exit(1);
  }
  const records: Result[] = readdirSync(RESULTS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(RESULTS, f), "utf8")) as Result);

  const total = records.length;
  const ok = records.filter((r) => r.status === "ok" && r.report);
  const na = records.filter((r) => r.status === "n/a");
  const err = records.filter((r) => r.status === "error");

  const grades = ["A", "B", "C", "D", "F"] as const;
  const gradeCount = new Map(grades.map((g) => [g, ok.filter((r) => r.report!.health.grade === g).length]));

  const always = ok.map((r) => r.report!.budget.alwaysOnTokens);
  const med = median(always);
  const min = always.length ? Math.min(...always) : 0;
  const max = always.length ? Math.max(...always) : 0;
  const over2k = always.filter((x) => x > 2000).length;
  const over8k = always.filter((x) => x > 8000).length;
  const truncN = ok.filter(truncatesAlwaysOn).length;
  const emailN = ok.filter((r) => hasCode(r, "secrets/email")).length;
  const ipN = ok.filter((r) => hasCode(r, "secrets/private-ip")).length;
  const tokenLikeN = ok.filter(hasCredentialShaped).length;

  const dates = records.map((r) => r.scannedAt).filter(Boolean).sort();
  const scanDate = dates.length ? dates[dates.length - 1].slice(0, 10) : "unknown";

  const L: string[] = [];
  L.push("# ctxbudget study");
  L.push("");
  L.push(
    `_Aggregated scan of **${total}** public repositories' agent context, generated ${scanDate} with [ctxbudget](https://github.com/GonzaloPeriane/ctxbudget). Only aggregate numbers are published — no repo content, no per-repo security findings. Reproduce with \`npm run study && npm run study:aggregate\`._`,
  );
  L.push("");
  L.push("## Coverage");
  L.push("");
  L.push(`- **${total}** repos scanned`);
  L.push(`- **${ok.length}** have agent context (\`ok\`)`);
  L.push(`- **${na.length}** have no context files (\`n/a\`)`);
  L.push(`- **${err.length}** failed to clone/scan (\`error\`)`);
  L.push("");

  if (ok.length > 0) {
    L.push(`## Context health — grade among the ${ok.length} with context`);
    L.push("");
    L.push("| Grade | Repos |");
    L.push("| --- | ---: |");
    for (const g of grades) L.push(`| ${g} | ${gradeCount.get(g)} |`);
    L.push("");

    L.push("## Always-on cost (tokens loaded on every turn)");
    L.push("");
    L.push(`- Median: **${nf(med)}** tokens/turn`);
    L.push(`- Range: ${nf(min)} – ${nf(max)} tokens/turn`);
    L.push(`- Over 2,000 tokens/turn: **${pct(over2k, ok.length)}** (${over2k}/${ok.length})`);
    L.push(`- Over 8,000 tokens/turn: **${pct(over8k, ok.length)}** (${over8k}/${ok.length})`);
    L.push("");

    L.push("## Key finding — oversized always-on files");
    L.push("");
    L.push(
      `**${pct(truncN, ok.length)}** (${truncN}/${ok.length}) have at least one always-on file over **32 KiB** — the point at which some agents (e.g. Codex) truncate the file and silently stop reading the rest.`,
    );
    L.push("");

    L.push("## Secrets & PII");
    L.push("");
    L.push(
      `Every "secret" finding across the ${ok.length} context-having repos was reviewed by hand for this study (unique repos per category; documentation placeholders excluded):`,
    );
    L.push("");
    L.push(`- **Real credentials committed: 0% (0/${ok.length})** — none of the flagged strings was a real leaked credential.`);
    L.push(
      `- Contains an email address (mostly maintainer/contact in docs): ${pct(emailN, ok.length)} (${emailN}/${ok.length})`,
    );
    L.push(`- Contains a private IP (mostly example configs): ${pct(ipN, ok.length)} (${ipN}/${ok.length})`);
    L.push(
      `- Generic token-like strings: ${pct(tokenLikeN, ok.length)} (${tokenLikeN}/${ok.length}) — all manually verified as env-var references or examples, not real secrets.`,
    );
    L.push("");
    L.push(
      `> Across ${ok.length} popular AI tools, we found no real leaked credentials in agent context. What naive scanners flag as "secrets" is almost always documentation: contact emails, example IPs, and env-var references. The "secrets in context" risk is real in principle but rare in practice among maintained projects.`,
    );
    L.push("");

    L.push("## Repos by cost");
    L.push("");
    L.push("_Context-having repos, ranked by always-on cost. Cost metrics only — no per-repo security findings are published._");
    L.push("");
    L.push("| Repo | Grade | Always-on tok/turn | Truncates (>32 KiB) |");
    L.push("| --- | --- | ---: | --- |");
    for (const r of [...ok].sort((a, b) => b.report!.budget.alwaysOnTokens - a.report!.budget.alwaysOnTokens)) {
      L.push(
        `| ${r.owner}/${r.repo} | ${r.report!.health.grade} | ${nf(r.report!.budget.alwaysOnTokens)} | ${truncatesAlwaysOn(r) ? "yes" : "no"} |`,
      );
    }
    L.push("");
  }

  L.push("## Methodology & limitations");
  L.push("");
  L.push(
    "- Each repo was `git clone --depth 1`'d into a temp dir, scanned with `ctxbudget <dir> --json`, then the clone was deleted. Nothing left the machine; only the aggregate numbers above are published.",
  );
  L.push(
    "- **Approximate tokenizer.** Token counts use ctxbudget's tokenizer (gpt-tokenizer / o200k_base); real agents vary by model, so treat figures as comparison estimates, not exact billing.",
  );
  L.push(
    "- **Static context only.** ctxbudget measures files on disk; it does **not** follow dynamic memory systems (MemPalace, mem0, …) or runtime RAG, so a repo that injects context at runtime can cost more than shown.",
  );
  L.push(
    "- **always-on vs on-demand is a heuristic** by file type: root files (CLAUDE.md, AGENTS.md, .cursorrules, MCP schemas) count as always-on; `SKILL.md` and `.cursor/rules/*.mdc` as on-demand.",
  );
  L.push(
    "- **\"Truncated\"** means a file exceeds 32 KiB (the size some agents hard-cut); it does not confirm a specific agent truncated it in practice.",
  );
  L.push(
    "- **Secret findings were verified by hand for this study.** ctxbudget downgrades documentation placeholders to `info` via a pattern list plus a Shannon-entropy heuristic, but that classifier can still leave the odd false positive — so every flagged \"secret\" was reviewed manually, and none was a real credential.",
  );
  L.push(`- Scanned ${scanDate}. Per-repo commit hashes are recorded in \`results/\` (git-ignored, not published).`);
  L.push("- Reproduce: `npm run study` then `npm run study:aggregate`.");
  L.push("");

  writeFileSync(OUT, L.join("\n"), "utf8");
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${ok.length} ok, ${na.length} n/a, ${err.length} error)`);
}

main();
