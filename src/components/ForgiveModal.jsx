import { useEffect, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';
import { MISC_CATEGORY_ID } from '../lib/defaults.js';
import { parseAmount, round2, formatINR } from '../lib/money.js';
import { computeFriendBalances } from '../lib/selectors.js';

/**
 * Bi-directional Forgive / Round Off a debt.
 *
 * Direction A — "I Forgive Them" (friend owes you): the forgiveness is a
 * personal expense booked under Miscellaneous, so the budget absorbs the
 * loss while the books stay reconciled (zero cash flow).
 *
 * Direction B — "They Forgive Me" (you owe the friend): a strict zero-cashflow
 * ledger adjustment that shrinks your debt toward 0. It never touches
 * UPI / UPI Lite / Physical Cash and never counts against monthly budget.
 */
export default function ForgiveModal({ open, onClose, friendId, transaction }) {
  const { state, addTransaction, updateTransaction, deleteTransaction } = useApp();
  const targetFriendId = transaction?.friendId ?? friendId;
  const friend = state.friends.find((f) => f.id === targetFriendId);
  const nets = computeFriendBalances(state);
  const net = round2(nets[targetFriendId] ?? 0); // + they owe you, − you owe them

  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('owed_by_friend'); // 'owed_by_friend' | 'owed_by_you'
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    // Default amount = the full outstanding debt (custom rounding allowed).
    setAmount(
      transaction ? String(transaction.amount ?? '') : Math.abs(net) > 0 ? String(Math.abs(net)) : '',
    );
    // Legacy records carry no direction and were always "you forgave them".
    setDirection(
      transaction
        ? transaction.direction || 'owed_by_friend'
        : net < 0
          ? 'owed_by_you'
          : 'owed_by_friend',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction]);

  const isByThem = direction === 'owed_by_you';
  // Forgiveness can never exceed the debt of the selected direction.
  const limit = round2(isByThem ? Math.max(0, -net) : Math.max(0, net));
  const amountNum = parseAmount(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0;
  const overLimit = !transaction && valid && amountNum - limit > 0.009;
  const afterBalance = round2(net + (valid ? (isByThem ? amountNum : -amountNum) : 0));
  const canForgive = transaction || Math.abs(net) > 0.009;

  const handleSave = () => {
    if (!valid) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (overLimit) {
      setError(
        isByThem
          ? `They can only forgive up to ${formatINR(limit)} (what you currently owe them).`
          : `You can only forgive up to ${formatINR(limit)} (what they currently owe you).`,
      );
      return;
    }
    const note = isByThem
      ? `Round off - ${friend?.name || 'friend'}`
      : `Forgiven debt - ${friend?.name || 'friend'}`;
    const savedDirection = isByThem ? 'owed_by_you' : 'owed_by_friend';
    if (transaction) {
      updateTransaction({
        ...transaction,
        amount: round2(amountNum),
        note,
        direction: savedDirection,
        categoryId: transaction.categoryId || MISC_CATEGORY_ID,
      });
    } else {
      addTransaction({
        type: 'forgive',
        amount: round2(amountNum),
        friendId: targetFriendId,
        categoryId: MISC_CATEGORY_ID,
        note,
        direction: savedDirection,
      });
    }
    onClose();
  };

  const handleDelete = () => {
    const msg = transaction?.direction === 'owed_by_you'
      ? 'Delete this round-off? The friend balance will be recalculated.'
      : 'Delete this forgiveness? The friend balance and your budget will be recalculated.';
    if (window.confirm(msg)) {
      deleteTransaction(transaction.id);
      onClose();
    }
  };

  const chipClass = (active) =>
    `rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
      active
        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
        : 'border-zinc-800 bg-zinc-950/60 text-zinc-400'
    }`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={transaction ? 'Edit Forgiveness' : `Forgive / Round Off${friend ? ` — ${friend.name}` : ''}`}
      footer={
        <div className="space-y-2">
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={!valid || !canForgive || overLimit}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-zinc-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isByThem ? 'Round Off — Zero Cash Flow' : 'Forgive & Book as Expense'}
          </button>
        </div>
      }
    >
      {!canForgive ? (
        <p className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm text-zinc-400">
          Neither of you owes anything right now — nothing to round off.
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
            <span className="text-xs text-zinc-500">
              {net > 0
                ? `Currently owed by ${friend?.name}`
                : net < 0
                  ? `You currently owe ${friend?.name}`
                  : 'No outstanding debt'}
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${
                net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-500'
              }`}
            >
              {formatINR(Math.abs(net))}
            </span>
          </div>

          {/* Direction — which side of the debt is being forgiven */}
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Direction
          </span>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!transaction && net <= 0}
              onClick={() => setDirection('owed_by_friend')}
              className={chipClass(direction === 'owed_by_friend')}
            >
              I Forgive Them
            </button>
            <button
              type="button"
              disabled={!transaction && net >= 0}
              onClick={() => setDirection('owed_by_you')}
              className={chipClass(direction === 'owed_by_you')}
            >
              They Forgive Me
            </button>
          </div>

          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Amount to round off
          </label>
          <div className="mb-4 flex items-center rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 focus-within:border-emerald-600">
            <span className="mr-1 text-lg font-semibold text-zinc-500">₹</span>
            <input
              autoFocus
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent py-3 text-2xl font-bold tabular-nums text-zinc-100 placeholder:text-zinc-700 outline-none"
            />
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/90">
            <div className="mb-2 flex items-center gap-1.5 font-semibold text-amber-300">
              <Undo2 className="h-3.5 w-3.5" />
              What happens when you save
            </div>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                {isByThem ? 'Your debt' : `${friend?.name}'s balance`} moves by{' '}
                {formatINR(valid ? amountNum : 0)} →{' '}
                <span className={`font-semibold ${afterBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {afterBalance >= 0 ? `+${formatINR(afterBalance)}` : `−${formatINR(Math.abs(afterBalance))}`}
                </span>
              </li>
              {isByThem ? (
                <>
                  <li>
                    Strictly a <strong>zero-cashflow ledger adjustment</strong> — it never touches UPI / UPI
                    Lite / Physical Cash.
                  </li>
                  <li>
                    Your <strong>monthly budget</strong> and Today&apos;s Spend stay completely unchanged.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    A {formatINR(valid ? amountNum : 0)} personal expense is booked under{' '}
                    <strong>Miscellaneous</strong> with note &quot;Forgiven debt - {friend?.name}&quot;.
                  </li>
                  <li>No money moves between accounts (zero cash flow).</li>
                </>
              )}
            </ul>
          </div>
        </>
      )}

      {transaction ? (
        <button
          type="button"
          onClick={handleDelete}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-400 transition active:scale-[0.99]"
        >
          <Trash2 className="h-4 w-4" />
          Delete Forgiveness
        </button>
      ) : null}
    </Modal>
  );
}
