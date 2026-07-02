# ctxweight study

_Aggregated scan of **42** public repositories' agent context, generated 2026-07-02 with [ctxweight](https://github.com/GonzaloPeriane/ctxweight). Only aggregate numbers are published — no repo content, no per-repo security findings. Reproduce with `npm run study && npm run study:aggregate`._

## Coverage

- **42** repos scanned
- **33** have agent context (`ok`)
- **4** have no context files (`n/a`)
- **5** failed to clone/scan (`error`)

## Context health — grade among the 33 with context

| Grade | Repos |
| --- | ---: |
| A | 12 |
| B | 6 |
| C | 3 |
| D | 5 |
| F | 7 |

## Always-on cost (tokens loaded on every turn)

- Median: **4,415** tokens/turn
- Range: 0 – 31,687 tokens/turn
- Over 2,000 tokens/turn: **70%** (23/33)
- Over 8,000 tokens/turn: **30%** (10/33)

## Key finding — oversized always-on files

**9%** (3/33) have at least one always-on file over **32 KiB** — the point at which some agents (e.g. Codex) truncate the file and silently stop reading the rest.

## Secrets & PII

Every "secret" finding across the 33 context-having repos was reviewed by hand for this study (unique repos per category; documentation placeholders excluded):

- **Real credentials committed: 0% (0/33)** — none of the flagged strings was a real leaked credential.
- Contains an email address (mostly maintainer/contact in docs): 18% (6/33)
- Contains a private IP (mostly example configs): 6% (2/33)
- Generic token-like strings: 6% (2/33) — all manually verified as env-var references or examples, not real secrets.

> Across 33 popular AI tools, we found no real leaked credentials in agent context. What naive scanners flag as "secrets" is almost always documentation: contact emails, example IPs, and env-var references. The "secrets in context" risk is real in principle but rare in practice among maintained projects.

## Repos by cost

_Context-having repos, ranked by always-on cost. Cost metrics only — no per-repo security findings are published._

| Repo | Grade | Always-on tok/turn | Truncates (>32 KiB) |
| --- | --- | ---: | --- |
| Kilo-Org/kilocode | F | 31,687 | yes |
| promptfoo/promptfoo | D | 26,497 | no |
| simstudioai/sim | F | 20,994 | no |
| langgenius/dify | C | 17,888 | no |
| langchain-ai/deepagents | B | 16,006 | no |
| CopilotKit/CopilotKit | F | 15,697 | no |
| crewAIInc/crewAI | D | 13,700 | yes |
| browser-use/browser-use | D | 11,647 | yes |
| activepieces/activepieces | F | 9,915 | no |
| mastra-ai/mastra | D | 8,987 | no |
| mem0ai/mem0 | F | 7,696 | no |
| infiniflow/ragflow | B | 6,557 | no |
| lobehub/lobehub | F | 6,149 | no |
| agno-agi/agno | B | 5,683 | no |
| openai/codex | B | 5,330 | no |
| aaif-goose/goose | A | 5,266 | no |
| charmbracelet/crush | C | 4,415 | no |
| openai/openai-agents-python | A | 3,555 | no |
| vercel/ai | B | 3,029 | no |
| cline/cline | A | 2,531 | no |
| QwenLM/qwen-code | D | 2,454 | no |
| vercel-labs/agent-browser | F | 2,303 | no |
| microsoft/autogen | A | 2,174 | no |
| danny-avila/LibreChat | A | 1,989 | no |
| browserbase/stagehand | B | 1,632 | no |
| assafelovic/gpt-researcher | A | 1,126 | no |
| continuedev/continue | A | 1,009 | no |
| langchain-ai/langgraph | A | 855 | no |
| google/adk-python | A | 324 | no |
| oraios/serena | A | 156 | no |
| RooCodeInc/Roo-Code | A | 95 | no |
| anthropics/claude-code | C | 0 | no |
| SWE-agent/SWE-agent | A | 0 | no |

## Methodology & limitations

- Each repo was `git clone --depth 1`'d into a temp dir, scanned with `ctxweight <dir> --json`, then the clone was deleted. Nothing left the machine; only the aggregate numbers above are published.
- **Approximate tokenizer.** Token counts use ctxweight's tokenizer (gpt-tokenizer / o200k_base); real agents vary by model, so treat figures as comparison estimates, not exact billing.
- **Static context only.** ctxweight measures files on disk; it does **not** follow dynamic memory systems (MemPalace, mem0, …) or runtime RAG, so a repo that injects context at runtime can cost more than shown.
- **always-on vs on-demand is a heuristic** by file type: root files (CLAUDE.md, AGENTS.md, .cursorrules, MCP schemas) count as always-on; `SKILL.md` and `.cursor/rules/*.mdc` as on-demand.
- **"Truncated"** means a file exceeds 32 KiB (the size some agents hard-cut); it does not confirm a specific agent truncated it in practice.
- **Secret findings were verified by hand for this study.** ctxweight downgrades documentation placeholders to `info` via a pattern list plus a Shannon-entropy heuristic, but that classifier can still leave the odd false positive — so every flagged "secret" was reviewed manually, and none was a real credential.
- Scanned 2026-07-02. Per-repo commit hashes are recorded in `results/` (git-ignored, not published).
- Reproduce: `npm run study` then `npm run study:aggregate`.
