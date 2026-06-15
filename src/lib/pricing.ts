import type { TokenUsage } from './types';

/** USD per 1M tokens. cache_write_5m = 1.25× input, cache_write_1h = 2× input,
 *  cache_read = 0.1× input. Sources: Anthropic official pricing docs (2026). */
export const PRICING: Record<
  string,
  {
    input: number;
    output: number;
    cache_write_5m: number;
    cache_write_1h: number;
    cache_read: number;
  }
> = {
  // Opus 4.7 was repriced down to a new tier ($5/$25), distinct from older Opus.
  'claude-opus-4-7': {
    input: 5,
    output: 25,
    cache_write_5m: 6.25,
    cache_write_1h: 10,
    cache_read: 0.5,
  },
  'claude-opus-4-6': {
    input: 15,
    output: 75,
    cache_write_5m: 18.75,
    cache_write_1h: 30,
    cache_read: 1.5,
  },
  'claude-opus-4': {
    input: 15,
    output: 75,
    cache_write_5m: 18.75,
    cache_write_1h: 30,
    cache_read: 1.5,
  },
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
    cache_read: 0.3,
  },
  'claude-sonnet-4': {
    input: 3,
    output: 15,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
    cache_read: 0.3,
  },
  'claude-haiku-4-5': {
    input: 1,
    output: 5,
    cache_write_5m: 1.25,
    cache_write_1h: 2,
    cache_read: 0.1,
  },
  'claude-haiku-4': {
    input: 1,
    output: 5,
    cache_write_5m: 1.25,
    cache_write_1h: 2,
    cache_read: 0.1,
  },
  default: {
    input: 3,
    output: 15,
    cache_write_5m: 3.75,
    cache_write_1h: 6,
    cache_read: 0.3,
  },
};

export function resolvePricing(model: string | null | undefined) {
  if (!model) return { rates: PRICING.default, known: false };
  if (PRICING[model]) return { rates: PRICING[model], known: true };
  const stripped = model.replace(/\[[^\]]+\]$/, '').replace(/-\d{8}$/, '');
  if (PRICING[stripped]) return { rates: PRICING[stripped], known: true };
  return { rates: PRICING.default, known: false };
}

export function calcCost(model: string | null | undefined, usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  if (usage.priced === false) return 0;
  const { rates } = resolvePricing(model);
  const inp = Number(usage.input_tokens) || 0;
  const out = Number(usage.output_tokens) || 0;
  const cr = Number(usage.cache_read_input_tokens) || 0;

  // Prefer the 5m/1h breakdown for cache writes. If absent, fall back to treating
  // the aggregate `cache_creation_input_tokens` as 5m (the cheaper, more common tier).
  let cw5 = 0;
  let cw1h = 0;
  const cc = usage.cache_creation;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    cw5 = Number(cc.ephemeral_5m_input_tokens) || 0;
    cw1h = Number(cc.ephemeral_1h_input_tokens) || 0;
  } else {
    cw5 = Number(usage.cache_creation_input_tokens) || 0;
  }

  return (
    (inp * rates.input +
      out * rates.output +
      cw5 * rates.cache_write_5m +
      cw1h * rates.cache_write_1h +
      cr * rates.cache_read) /
    1_000_000
  );
}
