import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SessionDetail } from '../lib/types';
import { calcCost, resolvePricing } from '../lib/pricing';
import { formatCost, formatTokens } from '../lib/format';

type Row = {
  i: number;
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  cumInput: number;
  cumOutput: number;
  cumCacheRead: number;
  cumCacheCreation: number;
  cost: number;
  cumCost: number;
  knownPricing: boolean;
};

export function TokenChart({ detail }: { detail: SessionDetail }) {
  const [chart, setChart] = useState<'cumulative' | 'perMessage' | 'cost'>('cumulative');

  const { rows, totals } = useMemo(() => {
    const rows: Row[] = [];
    let cumInput = 0;
    let cumOutput = 0;
    let cumCacheRead = 0;
    let cumCacheCreation = 0;
    let cumCost = 0;
    let i = 0;
    let knownAll = true;
    for (const e of detail.entries) {
      if (e.type !== 'assistant') continue;
      if (!e.isFirstOfMessage) continue;
      const u = e.message?.usage;
      if (!u) continue;
      const input = Number(u.input_tokens) || 0;
      const output = Number(u.output_tokens) || 0;
      const cache_creation = Number(u.cache_creation_input_tokens) || 0;
      const cache_read = Number(u.cache_read_input_tokens) || 0;
      const cost = calcCost(e.message?.model, u);
      const { known } = resolvePricing(e.message?.model);
      if (!known) knownAll = false;
      cumInput += input;
      cumOutput += output;
      cumCacheRead += cache_read;
      cumCacheCreation += cache_creation;
      cumCost += cost;
      rows.push({
        i: ++i,
        input,
        output,
        cache_creation,
        cache_read,
        cumInput,
        cumOutput,
        cumCacheRead,
        cumCacheCreation,
        cost,
        cumCost,
        knownPricing: known,
      });
    }
    const t = detail.totalTokens;
    const cacheRead = Number(t.cache_read_input_tokens) || 0;
    const inputTok = Number(t.input_tokens) || 0;
    const cacheCreate = Number(t.cache_creation_input_tokens) || 0;
    const denom = inputTok + cacheRead + cacheCreate;
    const cacheHitRate = denom > 0 ? cacheRead / denom : 0;
    return {
      rows,
      totals: {
        input: inputTok,
        output: Number(t.output_tokens) || 0,
        cacheRead,
        cacheCreate,
        cost: detail.totalCostUsd,
        cacheHitRate,
        knownAll,
      },
    };
  }, [detail]);

  if (rows.length === 0) {
    return (
      <div className="p-8 text-sm text-gray-500 dark:text-gray-400">
        No assistant messages with usage data in this session.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto p-6 gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Input tokens" value={formatTokens(totals.input)} />
        <Stat label="Output tokens" value={formatTokens(totals.output)} />
        <Stat
          label="Cache hit rate"
          value={`${(totals.cacheHitRate * 100).toFixed(1)}%`}
          hint={`${formatTokens(totals.cacheRead)} read · ${formatTokens(totals.cacheCreate)} write`}
        />
        <Stat label="Total cost" value={formatCost(totals.cost)} hint={detail.model ?? undefined} />
      </div>

      {!totals.knownAll && (
        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded px-3 py-2">
          Some assistant messages used an unrecognised model — cost uses default pricing.
        </div>
      )}

      <div className="flex gap-1 text-xs">
        {(['cumulative', 'perMessage', 'cost'] as const).map((c) => (
          <button
            key={c}
            onClick={() => setChart(c)}
            className={
              'px-3 py-1.5 rounded border ' +
              (chart === c
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900')
            }
          >
            {c === 'cumulative'
              ? 'Cumulative tokens'
              : c === 'perMessage'
                ? 'Per-message tokens'
                : 'Cumulative cost'}
          </button>
        ))}
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-950">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            {chart === 'cumulative' ? (
              <AreaChart data={rows} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="i" stroke="currentColor" fontSize={11} />
                <YAxis stroke="currentColor" fontSize={11} tickFormatter={(v) => formatTokens(v)} />
                <Tooltip content={<TokenTooltip />} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="cumCacheRead"
                  stackId="1"
                  stroke="#9ca3af"
                  fill="#9ca3af"
                  fillOpacity={0.4}
                  name="cache_read"
                />
                <Area
                  type="monotone"
                  dataKey="cumCacheCreation"
                  stackId="1"
                  stroke="#a855f7"
                  fill="#a855f7"
                  fillOpacity={0.4}
                  name="cache_creation"
                />
                <Area
                  type="monotone"
                  dataKey="cumInput"
                  stackId="1"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.5}
                  name="input"
                />
                <Area
                  type="monotone"
                  dataKey="cumOutput"
                  stackId="1"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.5}
                  name="output"
                />
              </AreaChart>
            ) : chart === 'perMessage' ? (
              <BarChart data={rows} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="i" stroke="currentColor" fontSize={11} />
                <YAxis stroke="currentColor" fontSize={11} tickFormatter={(v) => formatTokens(v)} />
                <Tooltip content={<TokenTooltip />} />
                <Legend />
                <Bar dataKey="cache_read" stackId="b" fill="#9ca3af" name="cache_read" />
                <Bar dataKey="cache_creation" stackId="b" fill="#a855f7" name="cache_creation" />
                <Bar dataKey="input" stackId="b" fill="#3b82f6" name="input" />
                <Bar dataKey="output" stackId="b" fill="#10b981" name="output" />
              </BarChart>
            ) : (
              <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="i" stroke="currentColor" fontSize={11} />
                <YAxis stroke="currentColor" fontSize={11} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                <Tooltip content={<CostTooltip />} />
                <Line
                  type="monotone"
                  dataKey="cumCost"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="cum. cost"
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-950">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-semibold mt-0.5 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{hint}</div>}
    </div>
  );
}

function TokenTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 text-xs shadow-lg">
      <div className="font-semibold mb-1">Message #{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4 font-mono">
          <span style={{ color: p.color }}>{p.name}</span>
          <span>{formatTokens(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function CostTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 text-xs shadow-lg">
      <div className="font-semibold mb-1">Message #{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4 font-mono">
          <span style={{ color: p.color }}>{p.name}</span>
          <span>{formatCost(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
