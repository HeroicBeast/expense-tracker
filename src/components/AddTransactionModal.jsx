import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Trash2, ArrowRightLeft, Wallet, Receipt } from 'lucide-react';
import Modal from './Modal.jsx';
import CategoryIcon from './CategoryIcon.jsx';
import { useApp } from '../store/AppContext.jsx';
import {
  ACCOUNTS,
  INCOME_ACCOUNT_IDS,
  TRANSFER_PRESETS,
  ACCOUNT_LABELS,
} from '../lib/defaults.js';
import { parseAmount, round2, formatINR } from '../lib/money.js';
import { computeShares, equalShares, SPLIT_MODES } from '../lib/split.js';

const chipCls = (active, tone = 'emerald') =>
  `rounded-lg border px-3 py-2 text-xs font-medium transition ${
    active
      ? tone === 'emerald'
        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
        : 'border-zinc-500 bg-zinc-700/60 text-zinc-100'
      : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:text-zinc-200'
  }`;

const inputCls =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-emerald-600';

const MODES = [
  { id: 'expense', label: 'Expense', Icon: Receipt },
  { id: 'transfer', label: 'Transfer (1-Tap)', Icon: ArrowRightLeft },
  { id: 'income', label: 'Add Balance / Income', Icon: Wallet },
];

function blankForm() {
  return {
    mode: 'expense',
    amount: '',
    categoryId: 'food',
    source: 'upi', // 'upi' | 'upiLite' | 'cash' | 'friend'
    friendId: '',
    yourShare: '',
    splitOpen: false,
    splitFriends: [],
    splitMode: 'equal',
    manualShares: {},
    itemBases: {},
    sharedCharges: '',
    note: '',
    preset: 'topup', // 'topup' | 'withdraw' | 'custom'
    from: 'upi',
    to: 'upiLite',
    incomeAccount: 'upi',
  };
}

function formFromTransaction(tx) {
  const f = blankForm();
  f.amount = String(tx.amount ?? '');
  f.note = tx.note || '';
  if (tx.type === 'transfer') {
    f.mode = 'transfer';
    f.from = tx.from;
    f.to = tx.to;
    const preset = TRANSFER_PRESETS.find((p) => p.from === tx.from && p.to === tx.to);
    f.preset = preset ? preset.id : 'custom';
  } else if (tx.type === 'income') {
    f.mode = 'income';
    f.incomeAccount = tx.accountId;
  } else if (tx.type === 'expense') {
    f.categoryId = tx.categoryId;
    if (tx.paidBy === 'friend') {
      f.source = 'friend';
      f.friendId = tx.friendId || '';
      f.yourShare = String(tx.yourShare ?? tx.amount);
    } else {
      f.source = tx.accountId;
      if (tx.split?.shares?.length) {
        f.splitOpen = true;
        f.splitMode = tx.split.mode || 'equal';
        f.splitFriends = tx.split.shares.filter((s) => s.who !== 'you').map((s) => s.who);
        const manual = {};
        const bases = {};
        for (const s of tx.split.shares) {
          manual[s.who] = String(s.amount);
          bases[s.who] = String(s.amount);
        }
        f.manualShares = manual;
        f.itemBases = bases;
        f.sharedCharges = '0';
      }
    }
  }
  return f;
}

/**
 * Add / Edit transaction sheet.
 * Modes: Expense (with optional Splitwise-style split), 1-Tap Transfer,
 * Add Balance / Income. Editing keeps id + timestamp so retroactive
 * recalculation happens against the original date.
 */
export default function AddTransactionModal({ open, transaction, initialMode = 'expense', onClose }) {
  const { state, addTransaction, updateTransaction, deleteTransaction } = useApp();
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(transaction ? formFromTransaction(transaction) : { ...blankForm(), mode: initialMode });
  }, [open, transaction, initialMode]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const categories = useMemo(
    () => [...state.categories].sort((a, b) => a.order - b.order),
    [state.categories],
  );
  const friends = state.friends;

  const amountNum = parseAmount(form.amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;

  // Keep the amount field in sync with an itemized bill's derived total.
  const itemizedPreview = useMemo(() => {
    if (form.mode !== 'expense' || !form.splitOpen || form.splitMode !== 'itemized') return null;
    const participants = ['you', ...form.splitFriends];
    if (!participants.length) return null;
    return computeShares({
      mode: 'itemized',
      amount: amountNum,
      participants,
      bases: form.itemBases,
      sharedCharges: form.sharedCharges,
    });
  }, [form, amountNum]);

  useEffect(() => {
    if (itemizedPreview && !itemizedPreview.error && itemizedPreview.amount > 0) {
      setForm((f) => (String(round2(itemizedPreview.amount)) === f.amount ? f : { ...f, amount: String(round2(itemizedPreview.amount)) }));
    }
  }, [itemizedPreview]);

  const splitPreview = useMemo(() => {
    if (form.mode !== 'expense' || !form.splitOpen) return null;
    if (form.source === 'friend') return null;
    const participants = ['you', ...form.splitFriends];
    return computeShares({
      mode: form.splitMode,
      amount: amountNum,
      participants,
      manual: form.manualShares,
      bases: form.itemBases,
      sharedCharges: form.sharedCharges,
    });
  }, [form, amountNum]);

  // Prefill manual / itemized inputs with an equal split when they are empty.
  useEffect(() => {
    if (!form.splitOpen || !form.splitFriends.length || !amountValid) return;
    const participants = ['you', ...form.splitFriends];
    const eq = equalShares(amountNum, participants);
    setForm((f) => {
      const patch = {};
      if (f.splitMode === 'manual') {
        const missing = participants.some((p) => f.manualShares[p] === undefined || f.manualShares[p] === '');
        if (missing) {
          patch.manualShares = Object.fromEntries(eq.map((s) => [s.who, String(s.amount)]));
        }
      } else if (f.splitMode === 'itemized') {
        const missing = participants.some((p) => f.itemBases[p] === undefined || f.itemBases[p] === '');
        if (missing) {
          patch.itemBases = Object.fromEntries(eq.map((s) => [s.who, String(s.amount)]));
        }
      }
      return Object.keys(patch).length ? { ...f, ...patch } : f;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.splitOpen, form.splitFriends.join(','), form.splitMode, form.amount]);

  const toggleSplitFriend = (id) => {
    set({
      splitFriends: form.splitFriends.includes(id)
        ? form.splitFriends.filter((f) => f !== id)
        : [...form.splitFriends, id],
      manualShares: {},
      itemBases: {},
    });
  };

  const validate = () => {
    if (form.mode === 'transfer') {
      if (!amountValid) return 'Enter a transfer amount.';
      if (form.from === form.to) return 'Pick two different accounts.';
      return '';
    }
    if (form.mode === 'income') {
      if (!amountValid) return 'Enter an amount.';
      return '';
    }
    // expense
    if (!amountValid) return 'Enter an amount greater than zero.';
    if (!form.categoryId) return 'Pick a category.';
    if (form.source === 'friend') {
      if (!form.friendId) return 'Pick the friend who paid.';
      const your = form.yourShare === '' ? amountNum : parseAmount(form.yourShare);
      if (!Number.isFinite(your) || your <= 0) return 'Enter your share of the bill.';
      if (your - amountNum > 0.009) return "Your share can't exceed the bill total.";
      return '';
    }
    if (form.splitOpen) {
      if (!form.splitFriends.length) return 'Pick at least one friend to split with.';
      if (splitPreview?.error) return splitPreview.error;
    }
    return '';
  };

  const validationError = validate();

  const handleSave = () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    let tx;
    if (form.mode === 'transfer') {
      tx = {
        type: 'transfer',
        amount: round2(amountNum),
        from: form.from,
        to: form.to,
        note: form.note.trim(),
      };
    } else if (form.mode === 'income') {
      tx = {
        type: 'income',
        amount: round2(amountNum),
        accountId: form.incomeAccount,
        note: form.note.trim(),
      };
    } else if (form.source === 'friend') {
      const your = form.yourShare === '' ? amountNum : parseAmount(form.yourShare);
      tx = {
        type: 'expense',
        paidBy: 'friend',
        friendId: form.friendId,
        amount: round2(amountNum),
        yourShare: round2(your),
        categoryId: form.categoryId,
        note: form.note.trim(),
      };
    } else if (form.splitOpen && form.splitFriends.length) {
      tx = {
        type: 'expense',
        paidBy: 'you',
        accountId: form.source,
        amount: round2(splitPreview.amount),
        categoryId: form.categoryId,
        note: form.note.trim(),
        split: { mode: form.splitMode, shares: splitPreview.shares },
      };
    } else {
      tx = {
        type: 'expense',
        paidBy: 'you',
        accountId: form.source,
        amount: round2(amountNum),
        categoryId: form.categoryId,
        note: form.note.trim(),
      };
    }

    if (transaction) updateTransaction({ ...tx, id: transaction.id, ts: transaction.ts });
    else addTransaction(tx);
    onClose();
  };

  const handleDelete = () => {
    if (window.confirm('Delete this transaction? Balances, friend ledgers and totals will be recalculated.')) {
      deleteTransaction(transaction.id);
      onClose();
    }
  };

  const isExpense = form.mode === 'expense';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={transaction ? 'Edit Transaction' : 'Add Transaction'}
      footer={
        <div className="space-y-2">
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={Boolean(validationError)}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-zinc-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {transaction ? 'Save Changes' : form.mode === 'transfer' ? 'Record Transfer' : form.mode === 'income' ? 'Add Balance' : 'Save Expense'}
          </button>
        </div>
      }
    >
      {/* Mode switcher */}
      <div className="mb-4 grid grid-cols-3 gap-1.5 rounded-xl bg-zinc-950/60 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              set({ mode: m.id });
              setError('');
            }}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
              form.mode === m.id ? 'bg-zinc-800 text-zinc-100 shadow' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <m.Icon className="h-3.5 w-3.5" />
            <span className="truncate">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Amount */}
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Amount
      </label>
      <div className="mb-3 flex items-center rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 focus-within:border-emerald-600">
        <span className="mr-1 text-lg font-semibold text-zinc-500">₹</span>
        <input
          key={form.mode}
          autoFocus
          inputMode="decimal"
          enterKeyHint="next"
          placeholder="0"
          value={form.amount}
          onChange={(e) => set({ amount: e.target.value })}
          className="w-full bg-transparent py-3 text-2xl font-bold tabular-nums text-zinc-100 placeholder:text-zinc-700 outline-none"
        />
      </div>

      {/* ---------------- Expense mode ---------------- */}
      {isExpense ? (
        <>
          <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Category
          </label>
          <div className="mb-4 grid grid-cols-5 gap-1.5">
            {categories.map((c) => {
              const active = form.categoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => set({ categoryId: c.id })}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <CategoryIcon name={c.icon} className="h-4 w-4" />
                  <span className="w-full truncate text-center text-[9px] font-medium leading-tight">
                    {c.name}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Paid Via
          </label>
          <div className="mb-3 grid grid-cols-4 gap-1.5">
            {[...ACCOUNTS.map((a) => ({ id: a.id, label: a.label })), { id: 'friend', label: 'Friend Paid' }].map(
              (src) => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => {
                    set({ source: src.id, friendId: src.id === 'friend' ? form.friendId || friends[0]?.id || '' : form.friendId });
                    setError('');
                  }}
                  className={`rounded-lg border px-1 py-2 text-[11px] font-semibold transition ${
                    form.source === src.id
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {src.label}
                </button>
              ),
            )}
          </div>

          {form.source === 'friend' ? (
            <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Who paid at the counter?
              </p>
              {friends.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  No friends yet — add them from the <span className="text-zinc-300">Friends</span> tab first.
                </p>
              ) : (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {friends.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => set({ friendId: f.id })}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        form.friendId === f.id
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                          : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
                      }`}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              <label className="mb-1 block text-[11px] text-zinc-500">
                Your share (counted in your budget)
              </label>
              <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950">
                <span className="pl-3 text-sm text-zinc-500">₹</span>
                <input
                  inputMode="decimal"
                  placeholder={form.amount || '0'}
                  value={form.yourShare}
                  onChange={(e) => set({ yourShare: e.target.value })}
                  className="w-full bg-transparent px-2 py-2 text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 outline-none"
                />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-zinc-500">
                No money leaves your accounts — only your share counts as spend, and the payer's ledger adjusts.
              </p>
            </div>
          ) : (
            <>
              {/* Split accordion */}
              <button
                type="button"
                onClick={() => set({ splitOpen: !form.splitOpen, manualShares: {}, itemBases: {} })}
                className="mb-3 flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-left text-sm font-medium text-zinc-300 transition hover:border-zinc-700"
              >
                <span>Split this bill</span>
                <span className="flex items-center gap-2 text-xs text-zinc-500">
                  {form.splitOpen && form.splitFriends.length
                    ? `${form.splitFriends.length + 1} people`
                    : 'Optional'}
                  <ChevronDown className={`h-4 w-4 transition-transform ${form.splitOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>

              {form.splitOpen ? (
                <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                  {friends.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No friends yet — add them from the <span className="text-zinc-300">Friends</span> tab first.
                    </p>
                  ) : (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {friends.map((f) => {
                        const active = form.splitFriends.includes(f.id);
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => toggleSplitFriend(f.id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                              active
                                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                                : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
                            }`}
                          >
                            {f.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {form.splitFriends.length > 0 ? (
                    <>
                      <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-lg bg-zinc-900 p-1">
                        {SPLIT_MODES.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => set({ splitMode: m.id, manualShares: {}, itemBases: {} })}
                            className={`rounded-md px-1 py-1.5 text-[11px] font-semibold transition ${
                              form.splitMode === m.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>

                      {form.splitMode === 'manual' ? (
                        <div className="space-y-2">
                          {['you', ...form.splitFriends].map((who) => (
                            <div key={who} className="flex items-center gap-2">
                              <span className="w-24 shrink-0 truncate text-xs text-zinc-400">
                                {who === 'you' ? 'You' : friends.find((f) => f.id === who)?.name}
                              </span>
                              <div className="flex flex-1 items-center rounded-lg border border-zinc-800 bg-zinc-950">
                                <span className="pl-2 text-xs text-zinc-600">₹</span>
                                <input
                                  inputMode="decimal"
                                  value={form.manualShares[who] ?? ''}
                                  onChange={(e) =>
                                    set({ manualShares: { ...form.manualShares, [who]: e.target.value } })
                                  }
                                  className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums text-zinc-100 outline-none"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {form.splitMode === 'itemized' ? (
                        <div className="space-y-2">
                          {['you', ...form.splitFriends].map((who) => (
                            <div key={who} className="flex items-center gap-2">
                              <span className="w-24 shrink-0 truncate text-xs text-zinc-400">
                                {who === 'you' ? 'You' : friends.find((f) => f.id === who)?.name}
                              </span>
                              <div className="flex flex-1 items-center rounded-lg border border-zinc-800 bg-zinc-950">
                                <span className="pl-2 text-xs text-zinc-600">₹</span>
                                <input
                                  inputMode="decimal"
                                  value={form.itemBases[who] ?? ''}
                                  onChange={(e) => set({ itemBases: { ...form.itemBases, [who]: e.target.value } })}
                                  className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums text-zinc-100 outline-none"
                                />
                              </div>
                            </div>
                          ))}
                          <div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
                            <span className="w-24 shrink-0 text-xs text-zinc-400">Tax/Delivery</span>
                            <div className="flex flex-1 items-center rounded-lg border border-zinc-800 bg-zinc-950">
                              <span className="pl-2 text-xs text-zinc-600">₹</span>
                              <input
                                inputMode="decimal"
                                placeholder="0"
                                value={form.sharedCharges}
                                onChange={(e) => set({ sharedCharges: e.target.value })}
                                className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums text-zinc-100 outline-none"
                              />
                            </div>
                          </div>
                          <p className="text-[11px] text-zinc-500">
                            Shared charges are distributed proportionally to each itemized share. Bill total updates
                            automatically.
                          </p>
                        </div>
                      ) : null}

                      {splitPreview && !splitPreview.error ? (
                        <div className="mt-3 rounded-lg bg-zinc-900/80 p-2.5 text-[11px] leading-relaxed text-zinc-400">
                          {splitPreview.shares.map((s) => (
                            <span key={s.who} className="mr-2 inline-block">
                              <span className="text-zinc-500">
                                {s.who === 'you' ? 'You' : friends.find((f) => f.id === s.who)?.name}:
                              </span>{' '}
                              <span className="font-semibold tabular-nums text-zinc-200">
                                {formatINR(s.amount)}
                              </span>
                            </span>
                          ))}
                          <span className="block text-zinc-600">
                            Total {formatINR(splitPreview.amount)} · cash flow from {ACCOUNT_LABELS[form.source]}
                          </span>
                        </div>
                      ) : null}
                      {splitPreview?.error ? (
                        <p className="mt-2 text-[11px] text-amber-400">{splitPreview.error}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[11px] text-zinc-500">Select friends to split with — you're always included.</p>
                  )}
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {/* ---------------- Transfer mode ---------------- */}
      {form.mode === 'transfer' ? (
        <div className="mb-3 space-y-3">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {[...TRANSFER_PRESETS.map((p) => ({ id: p.id, label: p.label })), { id: 'custom', label: 'Custom' }].map(
              (p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (p.id === 'custom') set({ preset: 'custom' });
                    else {
                      const preset = TRANSFER_PRESETS.find((x) => x.id === p.id);
                      set({ preset: p.id, from: preset.from, to: preset.to });
                    }
                  }}
                  className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition ${
                    form.preset === p.id
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {p.label}
                </button>
              ),
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">From</label>
              <select
                value={form.from}
                onChange={(e) => set({ from: e.target.value, preset: 'custom' })}
                disabled={form.preset !== 'custom'}
                className={`${inputCls} disabled:opacity-60`}
              >
                {ACCOUNTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">To</label>
              <select
                value={form.to}
                onChange={(e) => set({ to: e.target.value, preset: 'custom' })}
                disabled={form.preset !== 'custom'}
                className={`${inputCls} disabled:opacity-60`}
              >
                {ACCOUNTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] leading-snug text-sky-300/90">
            Internal transfers move money between your own accounts with <strong>zero impact</strong> on Today's
            Spend, the monthly budget or analytics.
          </p>
        </div>
      ) : null}

      {/* ---------------- Income mode ---------------- */}
      {form.mode === 'income' ? (
        <div className="mb-3">
          <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Deposit Into
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {ACCOUNTS.filter((a) => INCOME_ACCOUNT_IDS.includes(a.id)).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => set({ incomeAccount: a.id })}
                className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition ${
                  form.incomeAccount === a.id
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            External inflows (salary, ATM deposit, UPI credit) increase the balance but are never counted as spend.
          </p>
        </div>
      ) : null}

      {/* Note */}
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Note</label>
      <input
        type="text"
        maxLength={120}
        placeholder="Add a note..."
        value={form.note}
        onChange={(e) => set({ note: e.target.value })}
        className={inputCls}
      />

      {transaction ? (
        <button
          type="button"
          onClick={handleDelete}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-400 transition active:scale-[0.99]"
        >
          <Trash2 className="h-4 w-4" />
          Delete Transaction
        </button>
      ) : null}
    </Modal>
  );
}
