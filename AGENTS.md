# AGENTS.md

ctxbudget is a zero-dependency CLI that audits the **context** an AI coding agent
loads: it scores quality (`health`) and measures token cost (`budget`) of
`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `SKILL.md`, and connected MCP servers.
Offline-first: nothing the user scans ever leaves their machine.

## Commands

- `npm run dev -- <args>` — run the CLI from source (tsx). e.g. `npm run dev -- health .`
- `npm run build` — compile `src` → `dist` (tsc)
- `npm run typecheck` — type-check without emitting
- `node dist/cli.js .` — run the built binary

## Architecture

- `src/cli.ts` — arg parsing (`node:util` parseArgs) + dispatch. No command logic here.
- `src/commands/health.ts` — runs quality checks, returns a `HealthReport` + score.
- `src/commands/budget.ts` — token weight per source, returns a `BudgetReport`.
- `src/core/discover.ts` — walks the repo, returns `ContextFile[]`. Add new
  context-file types **here only** (the `EXACT` map / `classify`).
- `src/core/secrets.ts` — regex detectors → `Finding[]`.
- `src/core/tokenize.ts` — token estimate + pricing. Currently a chars/4 heuristic.
- `src/report/terminal.ts` — rendering. Keep all formatting in `report/*`.
- `src/core/types.ts` — shared types. Touch this before changing report shapes.

## Conventions

- ESM + `NodeNext`. Relative imports MUST use the `.js` extension (e.g.
  `./core/types.js`) even though the source is `.ts` — required by NodeNext.
- Node >= 18 (parseArgs). No runtime dependencies in the published package;
  keep new deps in `devDependencies` or justify them in the PR.
- Checks return `Finding`/report objects; they never call `console`. Only
  `report/*` and `cli.ts` print.

## What is done vs. stubbed

Done: discovery, budget/length checks, secret/PII scan, token estimate, terminal output.
Stubbed (search `TODO(claude)`): redundancy + drift + linter-overlap checks,
real tokenizer (`gpt-tokenizer`), MCP tool-schema accounting in `budget`,
`--sarif` / `--md` reporters, and a `--fail-on` CI exit gate.

## Rules

- Never log, store, or transmit scanned file contents. Offline-first is the
  product's core promise — no telemetry, no uploads.
- Do not add a context-file *generator*. ctxbudget is an auditor by design.
- Never put real secrets in test fixtures; use obvious fakes.
