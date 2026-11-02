import { useMemo, useState } from 'react';
import { Receipt, ArrowRightLeft } from 'lucide-react';
import BalancePills from '../components/BalancePills.jsx';
import TransactionRow from '../components/TransactionRow.jsx';
import AddTransactionModal from '../components/AddTransactionModal.jsx';
import SettleModal from '../components/SettleModal.jsx';
import ForgiveModal from '../components/ForgiveModal.jsx';
import { useApp } from '../store/AppContext.jsx';
import {
  computeAccountBalances,
  todaySpend,
  monthSpend,
  currentMonthKey,
  lastMonthVariance,
  sortNewestFirst,
  monthLabel,
} from '../lib/selectors.js';
import { formatINR, round2 } from '../lib/money.js';

function VarianceBadge({ variance }) {
  if (!variance.hasData) {
    return (
      <span className="rounded-full border border-zinc-700 bg-zinc-800/70 px-2.5 py-1 text-[10px] font-semibold text-zinc-400">
        Last Month ({variance.label}): No data
      </span>
    );
  }
  const isUnder = variance.diff >= 0;
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
        isUnder
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
      }`}
    >
      Last Month ({variance.label}): {formatINR(variance.amount)} {isUnder ? 'Under Budget' : 'Over Budget'}
    </span>
  );
}

/**
 * Home — live balance pills, hero "Today's Spend" card with monthly budget
 * progress + last month's variance reference, and the full master transaction
 * list (never truncated on month change).
 */
export default function Home({ pendingDelete, onRequestDelete }) {
  const { state, duplicateTransaction } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState('expense');
  const [editTx, setEditTx] = useState(null);

  // Optimistic soft delete: while an undo window is open, Home derives
  // everything from a view of the store without the pending transaction —
  // undo simply drops the filter, so the row and every total snap back.
  const visibleState = useMemo(
    () =>
      pendingDelete
        ? { ...state, transactions: state.transactions.filter((t) => t.id !== pendingDelete.tx.id) }
        : state,
    [state, pendingDelete],
  );

  const balances = useMemo(() => computeAccountBalances(visibleState), [visibleState]);
  const today = useMemo(() => todaySpend(visibleState), [visibleState]);
  const monthKey = currentMonthKey();
  const spend = useMemo(() => monthSpend(visibleState, monthKey), [visibleState, monthKey]);
  const variance = useMemo(() => lastMonthVariance(visibleState), [visibleState]);
  const transactions = useMemo(() => sortNewestFirst(visibleState.transactions), [visibleState]);

  const budget = round2(visibleState.settings.budget || 0);
  const remaining = round2(budget - spend.total);
  const pct = budget > 0 ? Math.min((spend.total / budget) * 100, 100) : 0;
  const overBudget = budget > 0 && spend.total > budget;
  const categoryById = useMemo(
    () => new Map(visibleState.categories.map((c) => [c.id, c])),
    [visibleState.categories],
  );
  const friendById = useMemo(
    () => new Map(visibleState.friends.map((f) => [f.id, f])),
    [visibleState.friends],
  );

  const openAdd = (mode) => {
    setAddMode(mode);
    setAddOpen(true);
  };

  const editKind = editTx
    ? editTx.type === 'settlement'
      ? 'settle'
      : editTx.type === 'forgive'
        ? 'forgive'
        : 'add'
    : null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-4">
      <BalancePills balances={balances} onTransfer={() => openAdd('transfer')} />

      {/* Hero metric card */}
      <section className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Today's Spend</p>
        <p className="mt-1 text-[2.5rem] font-bold leading-none tabular-nums text-zinc-50">{formatINR(today)}</p>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="tabular-nums text-zinc-400">
              {formatINR(spend.total)} <span className="text-zinc-600">/ {formatINR(budget)}</span>
            </span>
            <span className={`font-semibold tabular-nums ${overBudget ? 'text-rose-400' : 'text-emerald-400'}`}>
              {overBudget ? `${formatINR(Math.abs(remaining))} over` : `${formatINR(remaining)} remaining`}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${overBudget ? 'bg-rose-500' : 'bg-emerald-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-500">{monthLabel(monthKey, 'long')} budget</span>
            <VarianceBadge variance={variance} />
          </div>
        </div>
      </section>

      {/* Master transaction list */}
      <section className="mt-4">
        <div className="mb-1 flex items-center justify-between px-1">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">All Transactions</h2>
          <span className="text-[11px] tabular-nums text-zinc-600">{transactions.length}</span>
        </div>

        {transactions.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50 px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
              <Receipt className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-zinc-300">No transactions yet</p>
            <p className="max-w-[16rem] text-xs leading-relaxed text-zinc-500">
              Tap the <span className="font-semibold text-emerald-400">+</span> button to log your first expense,
              transfer or top-up. Everything stays on this device.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openAdd('expense')}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950"
              >
                Add Expense
              </button>
              <button
                type="button"
                onClick={() => openAdd('transfer')}
                className="flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Transfer
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            {transactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                category={
                  tx.categoryId ? categoryById.get(tx.categoryId) || null : null
                }
                friend={tx.friendId ? friendById.get(tx.friendId) || null : null}
                onOpen={() => setEditTx(tx)}
                onDuplicate={() => duplicateTransaction(tx.id)}
                onDeleteRequest={() => onRequestDelete(tx)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Modals */}
      <AddTransactionModal open={addOpen} initialMode={addMode} onClose={() => setAddOpen(false)} />
      <AddTransactionModal
        open={editKind === 'add' && !!editTx}
        transaction={editKind === 'add' ? editTx : null}
        onClose={() => setEditTx(null)}
      />
      <SettleModal
        open={editKind === 'settle'}
        transaction={editKind === 'settle' ? editTx : null}
        friendId={editTx?.friendId}
        onClose={() => setEditTx(null)}
      />
      <ForgiveModal
        open={editKind === 'forgive'}
        transaction={editKind === 'forgive' ? editTx : null}
        friendId={editTx?.friendId}
        onClose={() => setEditTx(null)}
      />
    </div>
  );
}
