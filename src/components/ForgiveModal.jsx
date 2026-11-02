import { useEffect, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';
import { MISC_CATEGORY_ID } from '../lib/defaults.js';
import { parseAmount, round2, formatINR } from '../lib/money.js';
import { computeFriendBalances } from '../lib/selectors.js';

/**
 * Forgive / Round Off a debt.
 *
 * If a friend owes you ₹20 and you forgive it, their balance resets by ₹20
 * and a ₹20 personal expense is booked under Miscellaneous with the auto-note
 * "Forgiven debt - [Friend Name]" — so the budget absorbs the cost and the
 * books stay reconciled (zero cash flow).
 */
export default function ForgiveModal({ open, onClose, friendId, transaction }) {
  const { state, addTransaction, updateTransaction, deleteTransaction } = useApp();
  const targetFriendId = transaction?.friendId ?? friendId;
  const friend = state.friends.find((f) => f.id === targetFriendId);
  const nets = computeFriendBalances(state);
  const owed = round2(nets[targetFriendId] ?? 0);

  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setAmount(transaction ? String(transaction.amount ?? '') : owed > 0 ? String(owed) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction]);

  const amountNum = parseAmount(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0;
  const overOwed = !transaction && valid && amountNum - owed > 0.009;
  const afterBalance = round2(owed - (valid ? amountNum : 0));

  const handleSave = () => {
    if (!valid) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (overOwed) {
      setError(`You can only forgive up to ${formatINR(owed)} (what they currently owe you).`);
      return;
    }
    const note = `Forgiven debt - ${friend?.name || 'friend'}`;
    if (transaction) {
      updateTransaction({
        ...transaction,
        amount: round2(amountNum),
        note,
        categoryId: transaction.categoryId || MISC_CATEGORY_ID,
      });
    } else {
      addTransaction({
        type: 'forgive',
        amount: round2(amountNum),
        friendId: targetFriendId,
        categoryId: MISC_CATEGORY_ID,
        note,
      });
    }
    onClose();
  };

  const handleDelete = () => {
    if (window.confirm('Delete this forgiveness? The friend balance and your budget will be recalculated.')) {
      deleteTransaction(transaction.id);
      onClose();
    }
  };

  const canForgive = transaction || owed > 0;

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
            disabled={!valid || !canForgive || overOwed}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-zinc-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Forgive & Book as Expense
          </button>
        </div>
      }
    >
      {!canForgive ? (
        <p className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm text-zinc-400">
          {friend?.name || 'This friend'} doesn't owe you anything right now — nothing to forgive.
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
            <span className="text-xs text-zinc-500">Currently owed by {friend?.name}</span>
            <span className={`text-sm font-bold tabular-nums ${owed > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {formatINR(owed)}
            </span>
          </div>

          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Amount to forgive
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
                {friend?.name}'s balance moves by {formatINR(valid ? amountNum : 0)} →{' '}
                <span className={`font-semibold ${afterBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {afterBalance >= 0 ? `+${formatINR(afterBalance)}` : `−${formatINR(Math.abs(afterBalance))}`}
                </span>
              </li>
              <li>
                A {formatINR(valid ? amountNum : 0)} personal expense is booked under <strong>Miscellaneous</strong>{' '}
                with note "Forgiven debt - {friend?.name}".
              </li>
              <li>No money moves between accounts (zero cash flow).</li>
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
