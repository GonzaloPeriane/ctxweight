// Shared types used across discovery, checks, and reporters.

export type Severity = "info" | "warn" | "error";

/**
 * How the agent loads a context source:
 * - `always`: loaded on every turn (root files like CLAUDE.md / AGENTS.md, MCP schemas).
 * - `ondemand`: loaded only when invoked (skills, individual Cursor rules).
 */
export type LoadKind = "always" | "ondemand";

export interface ContextFile {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the scanned root, used in reports. */
  relPath: string;
  /** Which kind of context source this is. */
  kind: ContextKind;
  /** Whether the agent loads this every turn or only on invocation. */
  load: LoadKind;
  content: string;
  bytes: number;
  lines: number;
  /**
   * Resolved relative paths of NON-context files this file pulls in via Claude
   * Code's `@path` import syntax (transitive, deduped). Imports that are
   * themselves discovered context files keep their own entry and are NOT folded
   * here (to avoid double-counting). Empty when there are no imports.
   */
  imports: string[];
  /** Summed tokens of `imports` (the import tree folded into this file). */
  importedTokens: number;
  /** `@import` specs that could not be resolved (missing/unreadable). */
  unresolvedImports: string[];
}

export type ContextKind =
  | "claude" // CLAUDE.md / CLAUDE.local.md
  | "agents" // AGENTS.md
  | "gemini" // GEMINI.md
  | "cursor" // .cursorrules / .cursor/rules/*.mdc
  | "windsurf" // .windsurfrules
  | "copilot" // .github/copilot-instructions.md
  | "skill" // **/SKILL.md
  | "other"; // CONTEXT_FOR_AI.md and friends

export interface Finding {
  severity: Severity;
  /** Stable machine code, e.g. "budget/too-long", "secrets/api-key". */
  code: string;
  message: string;
  /** Optional one-line, specific, actionable fix (see core/suggest.ts). */
  suggestion?: string;
  file?: string;
  line?: number;
}

export interface HealthReport {
  files: ContextFile[];
  findings: Finding[];
  /** 0-100, or `null` when there is no context to score (see `noContext`). */
  score: number | null;
  grade: string; // A..F, or "N/A" when noContext
  /** True when discover() found no agent-context files — nothing to audit. */
  noContext: boolean;
}

export interface BudgetEntry {
  label: string;
  /** Effective tokens this source contributes per load = own + imported. */
  tokens: number;
  /** always-on (counts every turn) vs on-demand (only when invoked). */
  load: LoadKind;
  /** Optional explanation rendered with the entry (e.g. why an MCP server is 0). */
  note?: string;
  /** Set only when the file pulls in @imports: the file's own tokens. */
  ownTokens?: number;
  /** Set only when the file pulls in @imports: tokens added by the import tree. */
  importedTokens?: number;
  /** Set only when the file pulls in @imports: the folded imported file paths. */
  imports?: string[];
}

export interface BudgetReport {
  entries: BudgetEntry[];
  /** Tokens loaded on every turn: always-on context files + MCP tool schemas. */
  alwaysOnTokens: number;
  /** Tokens that load only when their skill/rule is invoked. */
  onDemandTokens: number;
  /** Number of on-demand files (skills, Cursor rules). */
  onDemandCount: number;
  contextWindow: number;
  /** Estimated always-on input cost per turn (null unless `--model` is given). */
  estCostUsd: number | null;
}
