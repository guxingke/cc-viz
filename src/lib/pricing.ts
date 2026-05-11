import type { TokenUsage } from './types';

export const PRICING: Record<
  string,
  { input: number; output: number; cache_write: number; cache_read: number }
> = {
  'claude-opus-4-7': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-opus-4-6': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-sonnet-4': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
  'claude-haiku-4': { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
  default: { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
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
  const { rates } = resolvePricing(model);
  const inp = Number(usage.input_tokens) || 0;
  const out = Number(usage.output_tokens) || 0;
  const cw = Number(usage.cache_creation_input_tokens) || 0;
  const cr = Number(usage.cache_read_input_tokens) || 0;
  return (
    (inp * rates.input + out * rates.output + cw * rates.cache_write + cr * rates.cache_read) /
    1_000_000
  );
}
