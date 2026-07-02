// Centralized knowledge base for telling documentation placeholders apart from
// real secrets. Two layers that reinforce each other:
//   1. `isPlaceholder` — an explicit, extensible pattern list (grouped by
//      category below). Fast, precise, easy to extend.
//   2. `looksLikeRealSecret` — a Shannon-entropy + length heuristic that
//      generalizes *beyond* the list, so readable/repetitive values that nobody
//      thought to list (m0-your-api-key, sk-xxx, your-token) still fall through
//      as placeholders while random keys/tokens/hex/JWTs pass.
// Everything is case-insensitive.

// ── 1. Placeholder patterns, grouped by category. Add freely. ───────────────
const PLACEHOLDER_PATTERNS: RegExp[] = [
  // Generic placeholder words (whole value).
  /^(changeme|change[-_]me|example|placeholder|dummy|fake|sample|test|testing|redacted|none|null|n\/?a|foo|bar|baz|todo|secret|password|token|apikey|key|value)$/i,
  /^your[-_]/i, // your_api_key, your-token
  /[-_]here$/i, // api_key_here, value-here
  /^emulate[-_]/i, // emulate-google-secret
  /^(foo|bar|baz)([-_/].*)?$/i, // foo, foo/bar
  // A generic word appearing as a delimited segment of a compound value.
  /(^|[-_])(example|placeholder|dummy|fake|sample|redacted|changeme|your|test|todo)([-_]|$)/i,
  // Values literally labelled as a key/token/secret ("...-api-key", "-access-token").
  /[-_](api[-_]?key|api[-_]?token|api[-_]?secret|access[-_]?token)$/i,
  /^(your|my|the|a|some)[-_].*[-_](key|token|secret)$/i, // your-x-key, my-x-token

  // Fill / template sequences.
  /^x{3,}$/i, // xxx, xxxxxx
  /^(x[-_]){2,}x$/i, // x-x-x
  /\*{3,}/, // ******
  /^<.+>$/, // <token>, <your-key>
  /^\$\{.+\}$/, // ${API_KEY}
  /^%.+%$/, // %API_KEY%
  /^\{\{.+\}\}$/, // {{API_KEY}}

  // Common example API keys (known prefix + obviously-placeholder body).
  /^sk-(proj-)?x{2,}$/i, // sk-xxx, sk-proj-xxx
  /^m0-x{2,}$/i, // m0-xxx
  /^pk[-_]test[-_]/i, // pk-test-... / pk_test_...
];

export function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return PLACEHOLDER_PATTERNS.some((re) => re.test(v));
}

// ── 2. Entropy heuristic ────────────────────────────────────────────────────
/** Shannon entropy in bits per character. Random strings ≈ 4-6, prose ≈ 2-3. */
export function shannonEntropy(str: string): number {
  if (!str) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// Calibrated so readable/repetitive values (your-api-key, sk-xxx, hunter2) fall
// through while random keys/tokens/hex/JWTs pass. See scripts/test-secrets.ts.
const MIN_SECRET_LEN = 16; // body length: real credentials are rarely shorter
const MIN_SECRET_ENTROPY = 3.5; // bits/char: separates random from legible/repetitive

/** A captured value is a likely REAL secret only if it is not a known
 *  placeholder, is long enough, and is random enough. */
export function looksLikeRealSecret(value: string): boolean {
  const v = value.trim();
  if (isPlaceholder(v)) return false;
  if (v.length < MIN_SECRET_LEN) return false;
  return shannonEntropy(v) >= MIN_SECRET_ENTROPY;
}

// ── RFC 2606 reserved email domains (documentation/testing, never real PII) ──
const RESERVED_EMAIL_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_EMAIL_TLDS = [".example", ".test", ".invalid", ".localhost"];

export function isReservedEmailDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (RESERVED_EMAIL_DOMAINS.some((base) => d === base || d.endsWith(`.${base}`))) return true;
  return RESERVED_EMAIL_TLDS.some((tld) => d.endsWith(tld));
}
