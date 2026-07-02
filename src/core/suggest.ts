import type { ContextFile } from "./types.js";

// Actionable, mechanical fixes — the single place to edit suggestion wording.
// Each is one imperative line built from the finding's own data. Deterministic
// templates only (no LLM, no network). When a finding code has no concrete
// action, there is simply no template for it: we never emit vague "improve your
// context" coaching.

export function suggestOverTruncation(file: ContextFile): string {
  const kib = (file.bytes / 1024).toFixed(1);
  return `Split ${file.relPath} (${kib} KiB): move stable, rarely-read sections into @imported files or on-demand skills so the always-on core stays under 32 KiB.`;
}

export function suggestTooLong(file: ContextFile): string | undefined {
  // On-demand files only cost tokens when invoked — no urgent action, no advice.
  if (file.load !== "always") return undefined;
  return `Trim ${file.relPath} to the essentials, or split it via @imports and move task-specific guidance into on-demand skills.`;
}

const PII_CODES = new Set(["secrets/email", "secrets/private-ip"]);

export function suggestSecret(code: string): string {
  if (PII_CODES.has(code)) {
    return "Remove or redact this — context files are committed and sent to the agent on every run.";
  }
  return "Remove this value and inject it at runtime instead — context files are committed AND logged.";
}

export function suggestUnresolvedImport(): string {
  return "Fix or remove this @import — the referenced file wasn't found.";
}
