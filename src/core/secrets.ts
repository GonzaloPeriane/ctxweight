import { isReservedEmailDomain, looksLikeRealSecret } from "./placeholders.js";
import { suggestSecret } from "./suggest.js";
import type { ContextFile, Finding } from "./types.js";

// Lightweight, dependency-free detectors. Value-bearing detectors (generic
// token assignments, bearer tokens, OpenAI-style keys) capture the value and
// route it through the shared placeholder + entropy classifier: only a value
// that looks like a REAL secret is an error; documentation examples are `info`.
interface Detector {
  code: string;
  label: string;
  re: RegExp;
  /**
   * Optional predicate over a match: when it returns true the finding is
   * downgraded to an info `secrets/placeholder` (a documentation example, not a
   * real leak). `placeholderNote` explains why.
   */
  placeholder?: (m: RegExpExecArray) => boolean;
  placeholderNote?: string;
}

// Chars that can appear in a captured token/key value, including templating
// brackets so `<token>`, `${VAR}`, `%KEY%` placeholders are captured (then
// classified, not blindly flagged).
const VALUE = "[A-Za-z0-9._<>${}%!-]{6,}";
const EXAMPLE_NOTE = "Low-entropy / example value — looks like a documentation placeholder, not a real secret";

const notReal = (m: RegExpExecArray): boolean => !looksLikeRealSecret(m[1]);

const DETECTORS: Detector[] = [
  // Format-only detectors: the shape itself is the signal (no value classifier).
  { code: "secrets/private-key", label: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { code: "secrets/aws-key", label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },

  // Value-bearing detectors: capture group 1, classified by looksLikeRealSecret.
  {
    code: "secrets/openai-key",
    label: "OpenAI-style API key",
    re: /\b(sk-[A-Za-z0-9]{20,})\b/,
    placeholder: notReal,
    placeholderNote: EXAMPLE_NOTE,
  },
  {
    code: "secrets/bearer",
    label: "bearer token",
    re: new RegExp(`\\bBearer\\s+(${VALUE})`),
    placeholder: notReal,
    placeholderNote: EXAMPLE_NOTE,
  },
  {
    code: "secrets/generic-token",
    label: "generic api token assignment",
    re: new RegExp(`(?:api[_-]?key|secret|token|password|passwd|pwd)\\s*[:=]\\s*['"]?(${VALUE})['"]?`, "i"),
    placeholder: notReal,
    placeholderNote: EXAMPLE_NOTE,
  },

  { code: "secrets/private-ip", label: "private IPv4 address", re: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
  {
    code: "secrets/email",
    label: "email address",
    re: /\b[A-Za-z0-9._%+\-]+@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/,
    placeholder: (m) => isReservedEmailDomain(m[1]),
    placeholderNote: "Reserved documentation domain (RFC 2606), not real PII",
  },
];

export function scanSecrets(file: ContextFile): Finding[] {
  const findings: Finding[] = [];
  const lines = file.content.split("\n");
  lines.forEach((text, i) => {
    for (const d of DETECTORS) {
      const m = d.re.exec(text);
      if (!m) continue;

      // An obvious documentation example is not a leaked secret. Report it as
      // soft `info` so it never penalizes the score like a real secret and never
      // trips `--fail-on error`.
      if (d.placeholder && d.placeholder(m)) {
        findings.push({
          severity: "info",
          code: "secrets/placeholder",
          message: `${d.placeholderNote ?? "Looks like a documentation placeholder"} — ignored for scoring (${file.relPath}).`,
          file: file.relPath,
          line: i + 1,
        });
        continue;
      }

      findings.push({
        severity: d.code === "secrets/email" || d.code === "secrets/private-ip" ? "warn" : "error",
        code: d.code,
        message: `Possible ${d.label} committed into context (${file.relPath} is read by agents and logged).`,
        suggestion: suggestSecret(d.code),
        file: file.relPath,
        line: i + 1,
      });
    }
  });
  return findings;
}
