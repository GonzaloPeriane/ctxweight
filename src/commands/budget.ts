import path from "node:path";
import { discover } from "../core/discover.js";
import { readMcpServerCosts } from "../core/mcp.js";
import {
  estimateTokens,
  DEFAULT_CONTEXT_WINDOW,
  PRICING_USD_PER_MTOK,
} from "../core/tokenize.js";
import type { BudgetEntry, BudgetReport } from "../core/types.js";

interface BudgetOpts {
  model?: string;
  /**
   * Path to an MCP config file (e.g. `.mcp.json`) whose servers' tool schemas
   * should be counted. Defaults to `.mcp.json` in the scanned root.
   */
  mcp?: string;
  window?: number;
}

export async function runBudget(root: string, opts: BudgetOpts = {}): Promise<BudgetReport> {
  const files = await discover(root);
  const entries: BudgetEntry[] = files.map((f) => {
    const own = estimateTokens(f.content);
    // Effective cost = the file's own tokens + the @import tree folded into it.
    if (f.importedTokens > 0) {
      return {
        label: f.relPath,
        tokens: own + f.importedTokens,
        load: f.load,
        ownTokens: own,
        importedTokens: f.importedTokens,
        imports: f.imports,
      };
    }
    return { label: f.relPath, tokens: own, load: f.load };
  });

  // MCP tool-schema accounting: each connected server's tool definitions are
  // loaded into the agent's context on every turn. Use the explicit --mcp path,
  // otherwise auto-discover `.mcp.json` in the scanned root (no-op if absent).
  // MCP tool schemas are loaded on every turn → always-on.
  const mcpConfigPath = opts.mcp ?? path.join(root, ".mcp.json");
  for (const c of await readMcpServerCosts(mcpConfigPath)) {
    entries.push({ label: `mcp:${c.server} (schemas)`, tokens: c.tokens, load: "always", note: c.note });
  }

  // Group always-on first, then on-demand; heaviest first within each group.
  entries.sort((a, b) => (a.load === b.load ? b.tokens - a.tokens : a.load === "always" ? -1 : 1));

  const sum = (load: BudgetEntry["load"]) =>
    entries.filter((e) => e.load === load).reduce((s, e) => s + e.tokens, 0);
  const alwaysOnTokens = sum("always");
  const onDemandTokens = sum("ondemand");
  const onDemandCount = entries.filter((e) => e.load === "ondemand").length;

  const window = opts.window ?? DEFAULT_CONTEXT_WINDOW;
  const rate = opts.model ? PRICING_USD_PER_MTOK[opts.model] : undefined;
  // Cost reflects the always-on tokens — the fixed price paid on every turn.
  const estCostUsd = rate != null ? (alwaysOnTokens / 1_000_000) * rate : null;

  return { entries, alwaysOnTokens, onDemandTokens, onDemandCount, contextWindow: window, estCostUsd };
}
