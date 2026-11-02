import { ArrowRightLeft } from 'lucide-react';
import { ACCOUNTS } from '../lib/defaults.js';
import { formatINR } from '../lib/money.js';

/**
 * Compact header strip with live balances for UPI / UPI Lite / Physical Cash
 * plus the 1-tap Transfer / Top-Up button.
 */
export default function BalancePills({ balances, onTransfer }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ACCOUNTS.map((acc) => (
        <div
          key={acc.id}
          className="flex shrink-0 items-baseline gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5"
          title={acc.full}
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{acc.label}</span>
          <span className="text-sm font-semibold tabular-nums text-zinc-100">{formatINR(balances[acc.id] ?? 0)}</span>
        </div>
      ))}
      <button
        type="button"
        onClick={onTransfer}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition active:scale-95"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
        Transfer / Top-Up
      </button>
    </div>
  );
}
