import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

// Token estimation.
//
// Uses gpt-tokenizer's o200k_base encoding (the GPT-4o / o-series BPE) for an
// exact token count. Importing the encoding subpath instantiates the BPE merge
// ranks once at module load, so the encoder is cached at module level and
// `countTokens` reuses it on every call — no per-call re-initialization.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return countTokens(text);
}

// Rough per-1M-token input pricing, USD. TODO(claude): move to a
// maintained config file and let users pass --model.
export const PRICING_USD_PER_MTOK: Record<string, number> = {
  "claude-opus": 5,
  "claude-sonnet": 3,
  "claude-haiku": 1,
  "gpt-default": 2.5,
};

export const DEFAULT_CONTEXT_WINDOW = 200_000;
