# ctxaudit

**X-ray your AI agent's context — health and token cost in one command.**

`ctxaudit` is an offline, developer-first auditor for the context files that drive AI coding agents (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `copilot-instructions.md`, skills, and connected MCP servers). It tells you two things most teams are flying blind on:

1. **Is my context healthy?** — oversized, truncated files and leaked secrets (redundancy, drift, and contradiction checks are on the [roadmap](#roadmap)).
2. **What is my context costing me?** — how many tokens (and dollars) each piece eats on every single agent run.

> Think `npm audit`, but for the context window. No config leaves your machine.

---

## Example output

<!-- SCREENSHOT: replace with a color screenshot -->

Running `ctxaudit` on a real repo (`browser-use/browser-use`):

```
  ctxaudit · browser-use
  GRADE D  ·  always-on 11,647 tok/turn (5.8%)  ·  on-demand 11,720 tok
  always-on = read on every message · on-demand = only loaded when a skill/rule runs

  2 files too long · 1 truncated (>32 KiB) · 1 email in context
  truncated = too big; the agent cuts it off and won't read all of it

  Suggestions
    → Trim AGENTS.md to the essentials, or split it via @imports and move task-specific guidance into on-demand skills.
    → Split AGENTS.md (38.4 KiB): move stable, rarely-read sections into @imported files or on-demand skills so the always-on core stays under 32 KiB.
    → Remove or redact this — context files are committed and sent to the agent on every run.

  AGENTS.md                                           9,141 (39%) ██████·········· [always-on]
  CLAUDE.md                                           2,506 (11%) ██·············· [always-on]
  skills/x402/SKILL.md                                4,123 (18%) ███············· [on-demand]
  skills/qa/SKILL.md                                  2,250 (10%) ██·············· [on-demand]
  skills/remote-browser/SKILL.md                      1,839 ( 8%) █··············· [on-demand]
  browser_use/skills/browser-use/SKILL.md             1,145 ( 5%) █··············· [on-demand]
  skills/browser-use/SKILL.md                         1,145 ( 5%) █··············· [on-demand]
  … and 2 more (1,218 tokens, --full)
```

In a real terminal the grade badge and bars are colored (green A/B · amber C/D · red F). Add `--full` for every finding and every file.

---

## Why this exists

Every AI coding agent reads a context file before it does anything. The instinct is to make that file bigger — and that's exactly the trap.

A 2026 ETH Zürich study found that auto-generated, redundant context files *reduced* task success rates and *increased* inference cost by over 20%, mostly by duplicating what the agent could already read from the code and README. The failure modes are always the same:

- **Bloat** — files grow past the model's effective instruction budget; the rest is silently ignored ("lost in the middle").
- **Redundancy** — rules that restate the README or things a linter already enforces.
- **Drift** — `CLAUDE.md` and `AGENTS.md` and `.cursorrules` slowly disagree.
- **Leaked secrets** — these files are committed *and* end up in the agent's logged context, so an API key or internal hostname in there is a real exposure.
- **Invisible token cost** — config files, skills, and every connected MCP server's tool schema all consume the window on every run, and nobody is measuring it.

The market is full of *generators* for these files. `ctxaudit` is the opposite: an **auditor**. It doesn't write your context for you — it tells you what's wrong with the context you have and what it's costing you.

---

## What it does

### `ctxaudit health` — context quality

Scans every agent-context source in the repo and reports:

| Check | What it flags |
|---|---|
| **Budget / length** | Files over the recommended size (200 lines) or past the 32 KiB hard-truncation limit some agents enforce |
| **Secrets & PII** | API keys, tokens, private IPs and emails committed into context — with placeholder + entropy awareness, so it won't flag `your_api_key_here`, `m0-your-api-key`, or RFC 2606 `example.com` |

Output is a single **Context Health score** (A–F) plus an itemized, fixable list. A repo with no agent-context files at all scores **N/A** — "nothing to audit", not a perfect A.

**Planned (roadmap — not yet implemented):**

- **Redundancy** — content duplicated from the README, the code, or another context file
- **Drift** — the same rule present in one context file but missing or reworded in another
- **Contradictions** — conflicting rules (heuristic; optional semantic pass)
- **Linter overlap** — rules a formatter/linter already enforces deterministically

### `ctxaudit budget` — token cost

Not all context is loaded the same way, so `budget` reports **two** numbers instead of one — and this split is the whole point:

- **Always-on** — your root context files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, …) **plus every connected MCP server's tool schemas**. This is loaded on *every single turn*: it's your fixed per-turn token cost (and the only part that's really competing for the context window).
- **On-demand** — `SKILL.md` files and `.cursor/rules/*.mdc`, which load **only when that skill or rule is invoked**. A 600-line skill isn't bloat — you pay for it when you use it, not every turn.

This matters because tools that sum everything into one "tokens/run" number lie to you: 40k tokens of skills you rarely trigger is fine, while 40k tokens in `AGENTS.md` is a tax on every request. Real example — running on a repo with 39 skills and Cursor rules reports **~1,559 always-on tokens/turn** but **~41,000 on-demand** across those 39 files: the headline "43k" would be alarming and wrong.

For each source `budget` shows its token weight and whether it's **always-on** or **on-demand**, the always-on share of the context window, and (with `--model`) the estimated always-on input cost per turn.

MCP tool-schema accounting is the part no other tool gives you: connecting ten MCP servers can quietly burn thousands of *always-on* tokens on every turn before your prompt is even read. ctxaudit counts the schemas a server declares statically and — staying offline-first — flags servers that only expose tools at runtime instead of connecting to them.

---

## Quickstart

No install required:

```bash
npx ctxaudit .                 # health + budget for the current directory
```

Run a single command, and pick an output format:

```bash
npx ctxaudit health .                                      # quality checks only
npx ctxaudit budget . --model claude-opus --mcp .mcp.json  # token cost only
npx ctxaudit . --json                                      # machine-readable
npx ctxaudit . --sarif > ctxaudit.sarif                    # GitHub code scanning
npx ctxaudit . --md                                        # writes ctxaudit-report.md
npx ctxaudit . --fail-on secrets/aws-key,error             # CI exit gate (see below)
```

**Commands:** `ctxaudit [path]` (health + budget), `ctxaudit health [path]`, `ctxaudit budget [path]`.
**Flags:** `--model <name>`, `--mcp <file>`, `--json`, `--sarif`, `--md`, `--fail-on <list>`.

### Detecting problems

Point it at a `CLAUDE.md` that committed an AWS key, a real contact email, and a doc example (`user@example.com`):

```
  ctxaudit · my-repo
  GRADE D

  1 AWS key in context · 1 email in context

  Suggestions
    → Remove this value and inject it at runtime instead — context files are committed AND logged.
    → Remove or redact this — context files are committed and sent to the agent on every run.
```

The AWS key and the real contact email are flagged; the `user@example.com` doc example is **not** (RFC 2606 placeholder). Every finding carries a stable code (`secrets/aws-key`, `secrets/email`, …) you can target with `--fail-on` to gate CI. Add `--full` for per-finding detail with `file:line`.

---

## Output formats

- **Terminal** — human-readable summary (default)
- **`--json`** — machine-readable, for scripts
- **`--sarif`** — drops findings straight into the GitHub Security tab
- **`--md`** — a shareable `ctxaudit-report.md`

## CI / GitHub Actions

This repo dogfoods itself — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml). The pattern is **CI-safe in two halves**: a self-scan step writes the SARIF with `continue-on-error` so findings never fail *that* step, while a separate gate step uses `--fail-on` on secret codes to actually break the build. The SARIF upload runs with `if: always()`, so findings always reach the GitHub Security tab even when the gate fails.

```yaml
- name: Context audit (self) — generate SARIF
  continue-on-error: true
  run: node dist/cli.js . --sarif > ctxaudit.sarif

- name: Context audit gate — fail on leaked secrets
  run: node dist/cli.js . --fail-on secrets/private-key,secrets/aws-key,secrets/openai-key,secrets/generic-token

- name: Upload SARIF
  if: always()
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: ctxaudit.sarif
```

---

## Philosophy

- **Offline-first.** Your context never leaves your machine. No telemetry, ever. (Every cloud scanner asks you to upload the very config you're trying to keep private — `ctxaudit` doesn't.)
- **Auditor, not generator.** It measures and explains; it never silently rewrites your files.
- **GDPR-aware by default.** Secrets and PII detection is a first-class check, not an afterthought, because committed-and-logged context is a real data-exposure path.

---

## Limitations — what ctxaudit doesn't see

ctxaudit measures the **static** context on disk: `CLAUDE.md`, `AGENTS.md`, skills, `.cursorrules`, and the MCP tool schemas declared in your config. That's the part you can audit before a single turn runs.

It does **not** see context injected at **runtime**:

- **Dynamic memory systems** (MemPalace, mem0, and friends) that retrieve and inject content per query.
- **Runtime RAG** that pulls documents into the prompt on the fly.
- **MCP servers that only expose their tools on connect** — their schemas aren't in the static config, so ctxaudit reports them as `0` rather than guessing.

A one-line `CLAUDE.md` that points at a memory system will score **light** even though it injects thousands of tokens on every turn.

**Read the result as the cost of your _static_ context — not the real total if you rely on dynamic memory or runtime RAG.**

---

## Study — 33 popular repos

We scanned the agent context of 33 widely-used AI dev tools (Codex, Cline, Continue, crewAI, mem0, LibreChat, …). Always-on cost — the tokens loaded on **every** turn — ranged from **0 to ~31,700 tokens**, with **30% over 8,000 tokens/turn**. And the honest headline on security: **zero real leaked credentials**. What naive scanners flag as "secrets" is almost always documentation — contact emails, example IPs, and env-var references.

Full aggregate report (offline, reproducible with `npm run study`): [`scripts/study/STUDY.md`](scripts/study/STUDY.md).

---

## Roadmap

- [x] `health` checks: budget/length + secrets & PII
- [x] `budget` real tokenizer (`gpt-tokenizer`, `o200k_base`)
- [x] `budget` MCP tool-schema accounting (static schemas, offline)
- [x] SARIF + Markdown reporters
- [x] `--fail-on` CI exit gate
- [x] Follow `@import` references (Claude Code's `@AGENTS.md` / `@docs/x.md`) and count imported files transitively
- [x] Actionable fix suggestions per finding (split the file, move it to on-demand, fix the broken import, …)
- [x] Placeholder + entropy awareness for secret detection (skips `your_api_key_here`, `m0-your-api-key`, RFC 2606 `example.com`)
- [ ] `health` redundancy + drift checks (duplication vs. README / cross-file, `CLAUDE.md` ↔ `AGENTS.md` drift)
- [ ] Treat `process.env.*` references and env-var names as non-secrets (placeholder awareness v2)
- [ ] Memory-system awareness — estimate per-turn token injection from MemPalace / mem0-style stores and runtime RAG (today only static context is measured)
- [ ] Target budgets — "always-on uses X of Y recommended tokens", with a configurable per-turn ceiling
- [ ] `--mcp-connect`: measure real MCP schemas by launching each server in a sandbox and calling `tools/list` (opt-in)
- [ ] Optional `--llm` semantic pass for contradictions (local model supported)
- [ ] Shareable **Context Health badge** + web report card

## Contributing

Issues and PRs welcome. If `ctxaudit` should catch something it doesn't, open an issue with a minimal repro.

## License

Apache-2.0.

---

_Author: **[GonzaloPeriane](https://github.com/GonzaloPeriane)**._
