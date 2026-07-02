// Secret-detector calibration test. Runs the real scanSecrets over hand-picked
// placeholder vs. real values and prints a pass/fail table.
//   npm run test:secrets
import { scanSecrets } from "../src/core/secrets.js";
import { shannonEntropy } from "../src/core/placeholders.js";
import type { ContextFile, Finding } from "../src/core/types.js";

function scan(line: string): Finding | null {
  const file: ContextFile = {
    path: "fixture",
    relPath: "fixture",
    kind: "other",
    load: "always",
    content: line,
    bytes: line.length,
    lines: 1,
    imports: [],
    importedTokens: 0,
    unresolvedImports: [],
  };
  const findings = scanSecrets(file);
  // Most relevant finding: highest severity wins (error > warn > info).
  const rank = { error: 3, warn: 2, info: 1 } as const;
  return findings.sort((a, b) => rank[b.severity] - rank[a.severity])[0] ?? null;
}

interface Case {
  input: string;
  expect: "placeholder" | "real";
  note?: string;
}

const PLACEHOLDERS: Case[] = [
  { input: `api_key="sk-xxx"`, expect: "placeholder" },
  { input: `MEM0_API_KEY="m0-your-api-key"`, expect: "placeholder" },
  { input: `apiKey:"your-mem0-api-key"`, expect: "placeholder" },
  { input: `token=changeme`, expect: "placeholder" },
  { input: `Authorization: Bearer <token>`, expect: "placeholder" },
  { input: `KEY=<your-key>`, expect: "placeholder", note: "bare KEY= is not a detector keyword → no finding (safe)" },
  { input: `secret="example"`, expect: "placeholder" },
  { input: `password=hunter2`, expect: "placeholder", note: "short/low-entropy → info (weak/example, not a real leak)" },
];

const REAL: Case[] = [
  { input: `api_key="sk-A9f2Kd8Xm3Pq7Rv1Nw5Tz0Bc4Df"`, expect: "real", note: "random OpenAI-style key" },
  { input: `AKIAIOSFODNN7EXAMPLE`, expect: "real", note: "AWS doc example — kept as error (aws-key is format-only, not filtered)" },
  { input: `token=a3f8b2c1d4e5f60718293a4b5c6d7e8f90ab12cd`, expect: "real", note: "random 40-hex token" },
  {
    input: `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`, expect: "real", note: "real-shaped JWT" },
];

// A placeholder case passes if it is NOT flagged as a real secret error
// (i.e. it is info/secrets/placeholder, or produces no finding at all).
const isPass = (c: Case, f: Finding | null): boolean =>
  c.expect === "real" ? f?.severity === "error" : !(f && f.severity === "error");

function verdict(f: Finding | null): string {
  if (!f) return "none";
  return `${f.severity} ${f.code}`;
}

/** Best-effort extraction of the value the detectors classify, for display H. */
function extractValue(input: string): string {
  const bearer = /\bBearer\s+(\S+)/.exec(input);
  if (bearer) return bearer[1];
  const assign = /[:=]\s*['"]?([A-Za-z0-9._<>${}%!-]{4,})/.exec(input);
  if (assign) return assign[1];
  return input.trim();
}

function run(title: string, cases: Case[]): number {
  console.log(`\n${title}`);
  console.log("─".repeat(96));
  let failures = 0;
  for (const c of cases) {
    const f = scan(c.input);
    const pass = isPass(c, f);
    if (!pass) failures++;
    const ent = shannonEntropy(extractValue(c.input)).toFixed(2);
    const flag = pass ? "PASS" : "FAIL";
    console.log(
      `  ${flag}  ${c.input.slice(0, 42).padEnd(44)} → ${verdict(f).padEnd(26)} H≈${ent}${c.note ? `   (${c.note})` : ""}`,
    );
  }
  return failures;
}

const failures = run("PLACEHOLDERS — expect: not an error", PLACEHOLDERS) + run("REAL SECRETS — expect: error", REAL);
console.log(`\n${failures === 0 ? "✓ all cases passed" : `✗ ${failures} case(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
