import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';
import { ACCOUNTS, ACCOUNT_LABELS } from '../lib/defaults.js';
import { parseAmount, round2, formatINR } from '../lib/money.js';

/**
 * Settle Up modal — supports partial payments and multi-bill lump sums in
 * either direction, through any of the three accounts.
 *
 * Accounting: updates the chosen Account Balance and reduces/increases the
 * friend's net balance, but NEVER counts as personal expense or income.
 */
export default function SettleModal({ open, onClose, friendId, transaction }) {
  const { state, addTransaction, updateTransaction, deleteTransaction } = useApp();
  const friend = state.friends.find((f) => f.id === (transaction?.friendId ?? friendId));

  const [direction, setDirection] = useState('received');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('upi');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (transaction) {
      setDirection(transaction.direction || 'received');
      setAmount(String(transaction.amount ?? ''));
      setAccountId(transaction.accountId || 'upi');
    } else {
      setDirection('received');
      setAmount('');
      setAccountId('upi');
    }
  }, [open, transaction]);

  const amountNum = parseAmount(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0;

  const handleSave = () => {
    if (!valid) {
      setError('Enter an amount greater than zero.');
      return;
    }
    const tx = {
      type: 'settlement',
      direction,
      amount: round2(amountNum),
      accountId,
      friendId: transaction?.friendId ?? friendId,
      note: '',
    };
    if (transaction) updateTransaction({ ...tx, id: transaction.id, ts: transaction.ts });
    else addTransaction(tx);
    onClose();
  };

  const handleDelete = () => {
    if (window.confirm('Delete this settlement? Friend ledger and account balance will be recalculated.')) {
      deleteTransaction(transaction.id);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={transaction ? 'Edit Settlement' : `Settle Up${friend ? ` — ${friend.name}` : ''}`}
      footer={
        <div className="space-y-2">
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={!valid}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-zinc-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Record Settlement
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl bg-zinc-950/60 p-1">
        <button
          type="button"
          onClick={() => setDirection('received')}
          className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition ${
            direction === 'received' ? 'bg-emerald-500/15 text-emerald-400' : 'text-zinc-500'
          }`}
        >
          Received from Friend
        </button>
        <button
          type="button"
          onClick={() => setDirection('paid')}
          className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition ${
            direction === 'paid' ? 'bg-rose-500/15 text-rose-400' : 'text-zinc-500'
          }`}
        >
          Paid to Friend
        </button>
      </div>

      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Amount (partial or lump sum)
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

      <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Account
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        {ACCOUNTS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAccountId(a.id)}
            className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition ${
              accountId === a.id
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <p className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[11px] leading-snug text-zinc-500">
        {direction === 'received' ? (
          <>
            {friend?.name || 'Friend'} gives you <strong className="text-zinc-300">{formatINR(valid ? amountNum : 0)}</strong> via{' '}
            {ACCOUNT_LABELS[accountId]} — their balance drops, your account rises, and{' '}
            <span className="text-zinc-300">no personal income or expense</span> is booked.
          </>
        ) : (
          <>
            You give {friend?.name || 'friend'}{' '}
            <strong className="text-zinc-300">{formatINR(valid ? amountNum : 0)}</strong> via{' '}
            {ACCOUNT_LABELS[accountId]} — your account drops, their balance rises, and{' '}
            <span className="text-zinc-300">no personal expense</span> is booked.
          </>
        )}
      </p>

      {transaction ? (
        <button
          type="button"
          onClick={handleDelete}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-400 transition active:scale-[0.99]"
        >
          <Trash2 className="h-4 w-4" />
          Delete Settlement
        </button>
      ) : null}
    </Modal>
  );
}
