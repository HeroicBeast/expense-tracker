import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { useApp } from '../store/AppContext.jsx';
import {
  analyticsFor,
  currentMonthKey,
  shiftMonthKey,
  monthLabel,
} from '../lib/selectors.js';
import { formatINR, round2 } from '../lib/money.js';

function SummaryStat({ label, value, tone = 'text-zinc-100' }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

/**
 * Analytics — month-selector driven visuals that reset with the calendar.
 * Bar chart strictly excludes Rent / Electricity / Househelp (overheads),
 * so fixed housing costs never distort lifestyle category bars.
 */
export default function Analytics() {
  const { state } = useApp();
  const [monthKey, setMonthKey] = useState(() => currentMonthKey());
  const currentKey = currentMonthKey();

  const data = useMemo(() => analyticsFor(state, monthKey), [state, monthKey]);
  const canGoNext = shiftMonthKey(monthKey, 1) <= currentKey;
  const maxCat = Math.max(0, ...data.categoryRanking.map((r) => r.amount));
  const maxDaily = data.maxDailyVariable;
  const paceMax = Math.max(data.budget, data.total, 1);

  const breakdown = [
    { key: 'overhead', label: 'Fixed Overhead', amount: data.overhead, cls: 'bg-sky-500' },
    { key: 'variable', label: 'Variable Spend', amount: data.variable, cls: 'bg-emerald-500' },
    {
      key: 'remaining',
      label: data.over > 0 ? 'Over Budget' : 'Remaining Budget',
      amount: data.over > 0 ? data.over : data.remaining,
      cls: data.over > 0 ? 'bg-rose-500' : 'bg-zinc-700',
    },
  ];
  const breakdownTotal = round2(breakdown.reduce((a, b) => a + b.amount, 0)) || 1;

  // Cumulative pace polyline (0–100 coordinate space, non-uniform scale).
  const pacePoints = data.daily
    .map((d, i) => {
      const x = data.daily.length > 1 ? (i / (data.daily.length - 1)) * 100 : 0;
      const y = 100 - (d.cumulative / paceMax) * 100;
      return `${x.toFixed(2)},${Math.max(0, Math.min(100, y)).toFixed(2)}`;
    })
    .join(' ');
  const budgetY = Math.max(0, Math.min(100, 100 - (data.budget / paceMax) * 100));

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-4">
      <h1 className="text-lg font-bold text-zinc-100">Analytics</h1>

      {/* Month selector pill */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
          className="rounded-full border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition active:scale-95 hover:text-zinc-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[11rem] rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-center text-sm font-semibold text-zinc-100">
          {data.label}
        </span>
        <button
          type="button"
          aria-label="Next month"
          disabled={!canGoNext}
          onClick={() => canGoNext && setMonthKey(shiftMonthKey(monthKey, 1))}
          className="rounded-full border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition active:scale-95 hover:text-zinc-100 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Monthly summary */}
      <section className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Total Monthly Spend</p>
            <p className="mt-1 text-3xl font-bold leading-none tabular-nums text-zinc-50">{formatINR(data.total)}</p>
          </div>
          {data.lastMonth.hasData ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                data.lastMonth.diff >= 0
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
              }`}
            >
              Last Month ({data.lastMonth.label}): {formatINR(data.lastMonth.amount)}{' '}
              {data.lastMonth.diff >= 0 ? 'Under' : 'Over'}
            </span>
          ) : (
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[10px] font-semibold text-zinc-400">
              Last Month: No data
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SummaryStat label="Fixed Overhead" value={formatINR(data.overhead)} tone="text-sky-400" />
          <SummaryStat label="Variable Spend" value={formatINR(data.variable)} tone="text-emerald-400" />
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          Overheads = Rent + Electricity + Househelp. They count toward the budget but are excluded from the category
          chart below.
        </p>
      </section>

      {/* Chart 1 — Category horizontal bars */}
      <section className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5 text-zinc-500" />
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Category Spend (excl. Overheads)
          </h2>
        </div>

        {maxCat > 0 ? (
          <div className="space-y-2.5">
            {data.categoryRanking.map(({ category, amount }) => (
              <div key={category.id} className="flex items-center gap-2">
                <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-zinc-400">
                  <CategoryIcon name={category.icon} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{category.name}</span>
                </span>
                <span className="h-5 flex-1 overflow-hidden rounded bg-zinc-800/80">
                  <span
                    className="flex h-full items-center rounded bg-emerald-500/80 transition-all duration-500"
                    style={{ width: `${maxCat > 0 ? (amount / maxCat) * 100 : 0}%`, minWidth: amount > 0 ? '4px' : '0' }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-300">
                  {amount > 0 ? formatINR(amount) : '—'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-zinc-600">No variable spending recorded this month.</p>
        )}
      </section>

      {/* Chart 2 — Daily trend + cumulative budget pace */}
      <section className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Daily Spend Trend & Budget Pace
        </h2>

        <div className="relative mt-3 h-32">
          {/* Budget pace line */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              x1="0"
              y1={budgetY}
              x2="100"
              y2={budgetY}
              stroke="#71717a"
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={pacePoints}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Daily variable bars */}
          <div className="absolute inset-0 flex items-end gap-px">
            {data.daily.map((d) => (
              <div
                key={d.day}
                className="group relative flex-1"
                title={`Day ${d.day}: ${formatINR(d.variable)}`}
                style={{ height: '100%' }}
              >
                <div className="absolute inset-x-0 bottom-0 flex h-full items-end">
                  <div
                    className="w-full rounded-t-sm bg-emerald-500/85 transition-all duration-500"
                    style={{
                      height: `${maxDaily > 0 ? Math.max((d.variable / maxDaily) * 100, d.variable > 0 ? 3 : 0) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Day axis */}
        <div className="mt-1 flex justify-between text-[9px] tabular-nums text-zinc-600">
          <span>1</span>
          <span>{Math.round(data.daily.length / 2)}</span>
          <span>{data.daily.length}</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Daily variable spend
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 bg-sky-500" /> Cumulative total
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 border-t border-dashed border-zinc-500" /> Budget pace
          </span>
        </div>

        {/* Fixed vs Variable vs Remaining breakdown */}
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Budget Breakdown</p>
          <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
            {breakdown.map((b) => (
              <div
                key={b.key}
                className={b.cls}
                style={{ width: `${(b.amount / breakdownTotal) * 100}%` }}
                title={`${b.label}: ${formatINR(b.amount)}`}
              />
            ))}
          </div>
          <div className="mt-2.5 space-y-1.5">
            {breakdown.map((b) => (
              <div key={b.key} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <span className={`h-2.5 w-2.5 rounded-sm ${b.cls}`} />
                  {b.label}
                </span>
                <span className="font-semibold tabular-nums text-zinc-200">{formatINR(b.amount)}</span>
              </div>
            ))}
          </div>
          {data.over > 0 ? (
            <p className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-center text-[11px] font-semibold text-rose-400">
              {formatINR(data.over)} over the {formatINR(data.budget)} budget
            </p>
          ) : null}
        </div>
      </section>

      <div className="h-6" />
    </div>
  );
}
