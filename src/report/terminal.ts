import type { BudgetReport, Finding, HealthReport, LoadKind, Severity } from "../core/types.js";

const ICON = { info: "·", warn: "⚠", error: "✖" } as const;
const ON_DEMAND_TOP = 5; // compact view: on-demand budget entries shown before "… and N more"
const BAR_W = 16; // budget bar width in cells; full width = the largest entry (100% reference)
const PATH_MAX = 48; // paths longer than this are truncated through the middle

// ── Color (ANSI, dependency-free) ───────────────────────────────────────────
// Disabled when NO_COLOR is set or stdout is not a TTY (CI, pipe, redirect), so
// piped terminal output stays clean. (--json / --sarif never reach this module.)
const COLOR = process.env.NO_COLOR == null && process.stdout.isTTY === true;
const SGR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  black: "\x1b[30m",
  white: "\x1b[97m",
  green: "\x1b[32m",
  amber: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  bgGreen: "\x1b[42m",
  bgAmber: "\x1b[43m",
  bgRed: "\x1b[41m",
  bgGray: "\x1b[100m",
};
function paint(s: string, ...codes: string[]): string {
  return COLOR && codes.length ? `${codes.join("")}${s}${SGR.reset}` : s;
}
const gray = (s: string) => paint(s, SGR.gray);

const SEV_RANK: Record<Severity, number> = { info: 1, warn: 2, error: 3 };
const sevSgr = (sev: Severity): string => (sev === "error" ? SGR.red : sev === "warn" ? SGR.amber : SGR.gray);
function gradeSgr(grade: string): string {
  if (grade === "N/A") return SGR.gray;
  if (grade === "A" || grade === "B") return SGR.green;
  if (grade === "C" || grade === "D") return SGR.amber;
  return SGR.red; // F
}
function gradeBg(grade: string): string {
  if (grade === "N/A") return SGR.bgGray;
  if (grade === "A" || grade === "B") return SGR.bgGreen;
  if (grade === "C" || grade === "D") return SGR.bgAmber;
  return SGR.bgRed; // F
}

const num = (n: number) => n.toLocaleString("en-US");

// Short human labels for the grouped problem summary (counts, not a list).
// Codes absent here (e.g. secrets/placeholder) are not counted as problems.
const PROBLEM_LABEL: Record<string, (n: number) => string> = {
  "budget/too-long": (n) => `${n} file${n === 1 ? "" : "s"} too long`,
  "budget/over-truncation-limit": (n) => `${n} truncated (>32 KiB)`,
  "imports/unresolved": (n) => `${n} broken import${n === 1 ? "" : "s"}`,
  "secrets/email": (n) => `${n} email${n === 1 ? "" : "s"} in context`,
  "secrets/private-ip": (n) => `${n} private IP${n === 1 ? "" : "s"} in context`,
  "secrets/private-key": (n) => `${n} private key${n === 1 ? "" : "s"} in context`,
  "secrets/aws-key": (n) => `${n} AWS key${n === 1 ? "" : "s"} in context`,
  "secrets/openai-key": (n) => `${n} API key${n === 1 ? "" : "s"} in context`,
  "secrets/bearer": (n) => `${n} bearer token${n === 1 ? "" : "s"} in context`,
  "secrets/generic-token": (n) => `${n} token${n === 1 ? "" : "s"} in context`,
};

/** Readable path: normalize separators, truncate through the middle if long. */
function formatPath(relPath: string): string {
  const p = relPath.replace(/\\/g, "/");
  if (p.length <= PATH_MAX) return p;
  const segs = p.split("/");
  const tail = segs.slice(-2).join("/");
  const ellipsis = "/.../";
  const headBudget = PATH_MAX - tail.length - ellipsis.length;
  if (headBudget < 1) return `…/${tail}`.slice(0, PATH_MAX);
  let head = p.slice(0, headBudget);
  const lastSlash = head.lastIndexOf("/");
  if (lastSlash > 0) head = head.slice(0, lastSlash);
  return `${head}${ellipsis}${tail}`;
}

/** Derive a repo/base label from the scanned files (avoids needing the path). */
function scanLabel(health?: HealthReport): string {
  const f = health?.files[0];
  if (!f) return "";
  const root = f.path.slice(0, f.path.length - f.relPath.length).replace(/[\\/]+$/, "");
  return root.split(/[\\/]/).pop() || root;
}

/**
 * The grade as a standout badge. With color: a bold background block, e.g. ` C `
 * in amber. Without color: the uppercase word "GRADE C" so it still stands out
 * by format, not color.
 */
function gradeBadge(grade: string): string {
  if (!COLOR) return `GRADE ${grade}`;
  const fg = grade === "F" ? SGR.white : SGR.black;
  return `${SGR.bold}${gradeBg(grade)}${fg} ${grade} ${SGR.reset}`;
}

// ── Entry point: dominant verdict, then compact detail (all detail with --full)
export function printTerminal(health?: HealthReport, budget?: BudgetReport, opts: { full?: boolean } = {}): void {
  const full = opts.full ?? false;

  // Verdict block — the first, dominant thing. Blank line before and after.
  const label = scanLabel(health);
  console.log("");
  console.log(gray(`  ctxbudget${label ? ` · ${label}` : ""}`));
  console.log(`  ${verdictLine(health, budget)}`);
  if (budget) {
    console.log(gray("  always-on = read on every message · on-demand = only loaded when a skill/rule runs"));
  }
  console.log("");

  if (health) {
    if (health.noContext) {
      console.log(gray("  nothing to audit — no CLAUDE.md / AGENTS.md / .cursorrules / SKILL.md etc."));
    } else if (full) {
      printFindingGroups(health.findings);
    } else {
      printProblemsSummary(health.findings);
    }
    printSuggestions(health.findings, full);
  }

  if (budget && budget.entries.length > 0) printBudgetDetail(budget, full);
}

function verdictLine(health?: HealthReport, budget?: BudgetReport): string {
  const grade = health ? (health.noContext ? "N/A" : health.grade) : null;
  const rest: string[] = [];
  if (budget) {
    const winPct = ((budget.alwaysOnTokens / budget.contextWindow) * 100).toFixed(1);
    rest.push(`always-on ${num(budget.alwaysOnTokens)} tok/turn (${winPct}%)`, `on-demand ${num(budget.onDemandTokens)} tok`);
  }
  const restStr = rest.join("  ·  ");
  if (grade == null) return restStr; // budget-only
  const badge = gradeBadge(grade);
  if (!restStr) return badge;
  // Tint the whole verdict line with the grade's color so it reads as one signal.
  return `${badge}${paint(`  ·  ${restStr}`, gradeSgr(grade))}`;
}

// ── Problems: counts, not a list (default) ──────────────────────────────────
function printProblemsSummary(findings: Finding[]): void {
  const counts = new Map<string, number>();
  const worstSev = new Map<string, Severity>();
  for (const f of findings) {
    if (!PROBLEM_LABEL[f.code]) continue; // placeholders & non-problem codes excluded
    counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
    const cur = worstSev.get(f.code);
    if (!cur || SEV_RANK[f.severity] > SEV_RANK[cur]) worstSev.set(f.code, f.severity);
  }
  if (counts.size === 0) {
    console.log(gray("  no issues found"));
    return;
  }
  const segs = [...counts.entries()]
    .sort((a, b) => SEV_RANK[worstSev.get(b[0])!] - SEV_RANK[worstSev.get(a[0])!] || b[1] - a[1])
    .map(([code, n]) => PROBLEM_LABEL[code](n));
  console.log(`  ${segs.join(gray(" · "))}`);
  // One human gloss for the least-obvious count term.
  if (counts.has("budget/over-truncation-limit")) {
    console.log(gray("  truncated = too big; the agent cuts it off and won't read all of it"));
  }
}

// ── Suggestions: top 3 (all with --full), most severe first, deduped ────────
function printSuggestions(findings: Finding[], full: boolean): void {
  const bySeverity = [...findings].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  const uniq = [...new Set(bySeverity.map((f) => f.suggestion).filter((s): s is string => !!s))];
  if (uniq.length === 0) return;
  const shown = full ? uniq : uniq.slice(0, 3);
  console.log("");
  console.log(`  ${paint("Suggestions", SGR.bold)}`);
  for (const s of shown) console.log(`    ${gray("→")} ${s}`);
  const more = uniq.length - shown.length;
  if (more > 0) console.log(gray(`    +${more} more (--full)`));
}

// ── Per-item findings detail (--full only) ──────────────────────────────────
function printFindingGroups(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(gray("  no issues found"));
    return;
  }
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = groups.get(f.code);
    if (arr) arr.push(f);
    else groups.set(f.code, [f]);
  }
  const worst = (items: Finding[]): Severity =>
    items.reduce<Severity>((w, f) => (SEV_RANK[f.severity] > SEV_RANK[w] ? f.severity : w), "info");
  const ordered = [...groups.entries()].sort(
    (a, b) => SEV_RANK[worst(b[1])] - SEV_RANK[worst(a[1])] || b[1].length - a[1].length,
  );

  for (const [code, items] of ordered) {
    console.log(`  ${code} ${gray(`(${items.length})`)}`);
    const msgs = items.map(withReadablePath);
    const hoist = hoistedNote(msgs);
    if (hoist) console.log(gray(`    ↳ ${hoist.note}`));
    items.forEach((f, i) => {
      let m = msgs[i];
      if (hoist && m.endsWith(hoist.cut)) m = m.slice(0, m.length - hoist.cut.length).replace(/\s+$/, "");
      const where = f.line ? gray(`  (${formatPath(f.file ?? "")}:${f.line})`) : "";
      console.log(`    ${paint(ICON[f.severity], sevSgr(f.severity))} ${m}${where}`);
    });
  }
}

/** Replace the raw file path inside a finding's message with a readable one. */
function withReadablePath(f: Finding): string {
  return f.file ? f.message.split(f.file).join(formatPath(f.file)) : f.message;
}

/** Longest common trailing string across all messages. */
function commonSuffix(strs: string[]): string {
  if (strs.length === 0) return "";
  let suf = strs[0];
  for (let k = 1; k < strs.length && suf; k++) {
    const s = strs[k];
    let i = 0;
    const max = Math.min(suf.length, s.length);
    while (i < max && suf[suf.length - 1 - i] === s[s.length - 1 - i]) i++;
    suf = suf.slice(suf.length - i);
  }
  return suf;
}

/** A shared trailing clause across a group's messages, to show once as a note. */
function hoistedNote(messages: string[]): { note: string; cut: string } | null {
  if (messages.length < 2) return null;
  const cs = commonSuffix(messages);
  let at = -1;
  for (const d of ["; ", " — ", ". "]) {
    const idx = cs.indexOf(d);
    if (idx !== -1 && (at === -1 || idx < at)) at = idx;
  }
  if (at === -1) return null;
  const cut = cs.slice(at);
  const note = cut.replace(/^[\s;.—-]+/, "").replace(/\s*\.\s*$/, "").trim();
  return note.length >= 12 ? { note, cut } : null;
}

// ── Budget: always-on in full + top on-demand, sober proportional bars ───────
// The bar fills to the SAME share printed next to it (tokens / total context),
// over a fixed 16-cell width — so a 39% bar (6 cells) is visibly longer than an
// 18% bar (3 cells) and the number always matches the bar. Fill '█' vs empty '·'
// gives strong contrast so the filled fraction is unmistakable. Grayscale on
// purpose — the one strong color accent is the grade, not the bars.
function bar(frac: number, load: LoadKind): string {
  const filled = Math.max(0, Math.min(BAR_W, Math.round(frac * BAR_W)));
  const fill = "█".repeat(filled);
  const empty = "·".repeat(BAR_W - filled);
  if (!COLOR) return fill + empty; // same characters, no ANSI
  // Fill in the load's tone (always-on marked = default fg, on-demand faint =
  // gray); empty always a dim gray track.
  const fillCol = load === "always" ? fill : `${SGR.gray}${fill}${SGR.reset}`;
  return `${fillCol}${SGR.gray}${empty}${SGR.reset}`;
}

function printBudgetDetail(report: BudgetReport, full: boolean): void {
  const always = report.entries.filter((e) => e.load === "always");
  const onDemand = report.entries.filter((e) => e.load === "ondemand");
  const grand = report.alwaysOnTokens + report.onDemandTokens || 1;
  const pct = (tokens: number) => `${Math.round((tokens / grand) * 100)}%`;

  const line = (e: BudgetReport["entries"][number]): string => {
    const tag = e.load === "always" ? "[always-on]" : "[on-demand]";
    const n = e.imports?.length ?? 0;
    const suffix = n > 0 ? ` (+${n} import${n === 1 ? "" : "s"})` : "";
    const label = (formatPath(e.label) + suffix).padEnd(PATH_MAX, " ");
    return `  ${label} ${num(e.tokens).padStart(8)} ${gray(`(${pct(e.tokens).padStart(3)})`)} ${bar(e.tokens / grand, e.load)} ${gray(tag)}`;
  };
  const emit = (e: BudgetReport["entries"][number]) => {
    console.log(line(e));
    if (e.importedTokens && e.importedTokens > 0) {
      console.log(gray(`      ↳ ${num(e.ownTokens ?? 0)} own + ${num(e.importedTokens)} imported`));
      if (full && e.imports) for (const imp of e.imports) console.log(gray(`        · ${formatPath(imp)}`));
    }
    if (e.note) console.log(gray(`      ↳ ${e.note}`));
  };

  console.log("");
  for (const e of always) emit(e); // always-on = fixed cost, always shown
  const shown = full ? onDemand : onDemand.slice(0, ON_DEMAND_TOP);
  for (const e of shown) emit(e);
  const hidden = onDemand.length - shown.length;
  if (hidden > 0) {
    const m = onDemand.slice(shown.length).reduce((s, e) => s + e.tokens, 0);
    console.log(gray(`  … and ${hidden} more (${num(m)} tokens, --full)`));
  }

  if (report.estCostUsd != null) {
    console.log("");
    console.log(gray(`  → est. ~$${report.estCostUsd.toFixed(4)} always-on input cost per turn`));
  }
}
