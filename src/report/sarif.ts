import type { HealthReport, Severity } from "../core/types.js";

// SARIF severity levels: error → error, warn → warning, info → note.
const LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  error: "error",
  warn: "warning",
  info: "note",
};

/**
 * Convert a HealthReport into a SARIF 2.1.0 document (one result per finding).
 * Suitable for `github/codeql-action/upload-sarif` → the Security tab.
 */
export function toSarif(report: HealthReport, version = "0.1.0"): unknown {
  const { findings } = report;

  // One reportingDescriptor per unique finding code.
  const rules = [...new Set(findings.map((f) => f.code))].map((id) => ({
    id,
    name: id,
    shortDescription: { text: id },
  }));

  const results = findings.map((f) => {
    const result: Record<string, unknown> = {
      ruleId: f.code,
      level: LEVEL[f.severity],
      message: { text: f.message },
    };
    if (f.file) {
      result.locations = [
        {
          physicalLocation: {
            artifactLocation: { uri: f.file },
            ...(f.line ? { region: { startLine: f.line } } : {}),
          },
        },
      ];
    }
    return result;
  });

  const run: Record<string, unknown> = {
    tool: {
      driver: {
        name: "ctxaudit",
        informationUri: "https://github.com/GonzaloPeriane/ctxaudit",
        version,
        rules,
      },
    },
    results,
  };

  // No context to audit → surface N/A as a run notification rather than as a
  // clean (and misleading) zero-result pass.
  if (report.noContext) {
    run.invocations = [
      {
        executionSuccessful: true,
        toolExecutionNotifications: [
          {
            level: "note",
            message: { text: "No agent context files found — nothing to audit (health is N/A)." },
          },
        ],
      },
    ];
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [run],
  };
}
