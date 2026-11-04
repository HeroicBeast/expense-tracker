import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Plus,
  Users,
  HandCoins,
  Undo2,
  Pencil,
  ChevronRight,
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import CategoryIcon from '../components/CategoryIcon.jsx';
import AddTransactionModal from '../components/AddTransactionModal.jsx';
import SettleModal from '../components/SettleModal.jsx';
import ForgiveModal from '../components/ForgiveModal.jsx';
import { useApp } from '../store/AppContext.jsx';
import {
  friendSummary,
  friendLedger,
  transactionsInvolving,
  formatDateTime,
} from '../lib/selectors.js';
import { formatINR, formatSigned, parseAmount, round2 } from '../lib/money.js';
import { ACCOUNT_LABELS } from '../lib/defaults.js';

function balancePillClass(net) {
  if (net > 0) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  if (net < 0) return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
  return 'bg-zinc-800 text-zinc-400 border-zinc-700';
}

function describeEntry(tx, friendName, categoryById, effect) {
  if (tx.type === 'expense' && tx.paidBy !== 'friend') {
    const cat = categoryById.get(tx.categoryId);
    const you = tx.split?.shares?.find((s) => s.who === 'you');
    return {
      title: `Split bill${cat ? ` · ${cat.name}` : ''}`,
      sub:
        tx.split?.shares?.length > 1
          ? `Total ${formatINR(tx.amount)} · You ${formatINR(you?.amount ?? 0)} · ${friendName} ${formatINR(
              effect,
            )}`
          : `Total ${formatINR(tx.amount)} via ${ACCOUNT_LABELS[tx.accountId]}`,
      icon: cat?.icon || 'Shapes',
      isCategory: true,
    };
  }
  if (tx.type === 'expense' && tx.paidBy === 'friend') {
    const cat = categoryById.get(tx.categoryId);
    return {
      title: `${friendName} paid${cat ? ` · ${cat.name}` : ''}`,
      sub: `Bill ${formatINR(tx.amount)} · your share ${formatINR(tx.yourShare ?? 0)}`,
      icon: cat?.icon || 'Shapes',
      isCategory: true,
    };
  }
  if (tx.type === 'settlement') {
    const received = tx.direction === 'received';
    return {
      title: received ? `Settlement received` : `Settlement paid`,
      sub: `${formatINR(tx.amount)} via ${ACCOUNT_LABELS[tx.accountId]}`,
      icon: null,
      isCategory: false,
    };
  }
  if (tx.type === 'opening') {
    return {
      title: 'Initial Balance',
      sub: 'Pre-app debt migrated into the ledger',
      icon: null,
      isCategory: false,
    };
  }
  if (tx.type === 'forgive') {
    const byThem = tx.direction === 'owed_by_you';
    return {
      title: byThem ? 'Friend forgave debt' : 'Forgiven debt',
      sub: tx.note || (byThem ? `Round off - ${friendName}` : `Forgiven debt - ${friendName}`),
      icon: null,
      isCategory: false,
    };
  }
  return { title: tx.type, sub: '', icon: null, isCategory: false };
}

/** Splitwise-style offline friend ledger. */
export default function Friends() {
  const { state, addFriend, renameFriend, deleteFriend } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [initialAmount, setInitialAmount] = useState('');
  const [initialDirection, setInitialDirection] = useState('owes_me'); // 'owes_me' | 'i_owe'
  const [detailId, setDetailId] = useState(null);
  const [settleFor, setSettleFor] = useState(null);
  const [forgiveFor, setForgiveFor] = useState(null);
  const [editTx, setEditTx] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const summary = useMemo(() => friendSummary(state), [state]);
  const categoryById = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);
  const detailFriend = state.friends.find((f) => f.id === detailId) || null;
  const ledger = useMemo(
    () => (detailId ? friendLedger(state, detailId) : []),
    [state, detailId],
  );

  const resetAddFriendForm = () => {
    setNewName('');
    setInitialAmount('');
    setInitialDirection('owes_me');
  };

  const parsedInitial = parseAmount(initialAmount);
  const initialMagnitude =
    initialAmount.trim() !== '' && Number.isFinite(parsedInitial) ? Math.abs(round2(parsedInitial)) : 0;
  const signedInitial = initialDirection === 'i_owe' ? -initialMagnitude : initialMagnitude;

  const handleAddFriend = () => {
    const name = newName.trim();
    if (!name) return;
    // Signed opening balance seeds only the friend ledger — never accounts,
    // Today's Spend or the monthly budget (it is not a transaction).
    addFriend(name, signedInitial);
    resetAddFriendForm();
    setAddOpen(false);
  };

  const handleDeleteFriend = (friend) => {
    const history = transactionsInvolving(state, friend.id);
    if (history.length > 0) {
      window.alert(
        `Can't delete ${friend.name}: their ledger has ${history.length} record(s). History is kept so your books stay reconciled.`,
      );
      return;
    }
    if (window.confirm(`Delete ${friend.name}?`)) deleteFriend(friend.id);
  };

  const editKind = editTx
    ? editTx.type === 'settlement'
      ? 'settle'
      : editTx.type === 'forgive'
        ? 'forgive'
        : 'add'
    : null;

  const sortedFriends = useMemo(
    () =>
      [...state.friends].sort(
        (a, b) => Math.abs(summary.nets[b.id] ?? 0) - Math.abs(summary.nets[a.id] ?? 0) || a.name.localeCompare(b.name),
      ),
    [state.friends, summary.nets],
  );

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-4">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-100">Friends</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Friend
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Owed to You</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-400">{formatINR(summary.owedToYou)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">You Owe</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-rose-400">{formatINR(summary.youOwe)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Net</p>
          <p
            className={`mt-0.5 text-sm font-bold tabular-nums ${
              summary.net > 0 ? 'text-emerald-400' : summary.net < 0 ? 'text-rose-400' : 'text-zinc-400'
            }`}
          >
            {formatSigned(summary.net)}
          </p>
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-zinc-600">
        {summary.net > 0
          ? 'Net receivable — friends owe you in total.'
          : summary.net < 0
            ? 'Net payable — you owe friends in total.'
            : 'All settled up.'}
      </p>

      {/* Friend list */}
      {sortedFriends.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50 px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
            <Users className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-zinc-300">No friends yet</p>
          <p className="max-w-[16rem] text-xs leading-relaxed text-zinc-500">
            Add friends to split bills with them. Everything is offline and stays on this device.
          </p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950"
          >
            Add Friend
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {sortedFriends.map((f) => {
            const net = round2(summary.nets[f.id] ?? 0);
            return (
              <div key={f.id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setDetailId(f.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-zinc-800/60"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold uppercase text-zinc-300">
                    {f.name.trim().charAt(0) || '?'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">{f.name}</span>
                    <span className="block text-[11px] text-zinc-500">
                      {net > 0 ? 'owes you' : net < 0 ? 'you owe' : 'settled up'}
                    </span>
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums ${balancePillClass(net)}`}>
                    {formatSigned(net)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                </button>

                <div className="grid grid-cols-2 gap-px border-t border-zinc-800 bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => setSettleFor(f.id)}
                    className="flex items-center justify-center gap-1.5 bg-zinc-900 py-2.5 text-xs font-semibold text-zinc-300 transition active:bg-zinc-800"
                  >
                    <HandCoins className="h-3.5 w-3.5 text-emerald-400" />
                    Settle Up
                  </button>
                  <button
                    type="button"
                    onClick={() => setForgiveFor(f.id)}
                    disabled={Math.abs(net) < 0.005}
                    className="flex items-center justify-center gap-1.5 bg-zinc-900 py-2.5 text-xs font-semibold text-zinc-300 transition active:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
                    title={Math.abs(net) < 0.005 ? 'Nothing to round off' : 'Forgive / round off debt'}
                  >
                    <Undo2 className="h-3.5 w-3.5 text-amber-400" />
                    Forgive / Round Off
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------------- Friend detail overlay ---------------- */}
      {detailFriend ? (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-zinc-950">
          <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDetailId(null);
                  setRenaming(false);
                }}
                aria-label="Back"
                className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-900"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold uppercase text-zinc-300">
                {detailFriend.name.trim().charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                {renaming ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-emerald-600"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (renameValue.trim()) renameFriend(detailFriend.id, renameValue);
                        setRenaming(false);
                      }}
                      className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-bold text-zinc-950"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h1 className="truncate text-base font-bold text-zinc-100">{detailFriend.name}</h1>
                    <button
                      type="button"
                      aria-label="Rename"
                      onClick={() => {
                        setRenameValue(detailFriend.name);
                        setRenaming(true);
                      }}
                      className="text-zinc-600 transition hover:text-zinc-300"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setSettleFor(detailFriend.id)}
                className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-xs font-bold text-emerald-400 transition active:scale-[0.98]"
              >
                Settle Up
              </button>
              <button
                type="button"
                onClick={() => setForgiveFor(detailFriend.id)}
                disabled={Math.abs(summary.nets[detailFriend.id] ?? 0) < 0.005}
                className="flex-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 text-xs font-bold text-amber-400 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Forgive / Round Off
              </button>
              <button
                type="button"
                onClick={() => handleDeleteFriend(detailFriend)}
                className="rounded-xl border border-zinc-700 px-3 py-2.5 text-xs font-semibold text-zinc-500 transition hover:text-rose-400"
              >
                Delete
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">Current Net Balance</p>
              <p
                className={`mt-1 text-3xl font-bold tabular-nums ${
                  (summary.nets[detailFriend.id] ?? 0) > 0
                    ? 'text-emerald-400'
                    : (summary.nets[detailFriend.id] ?? 0) < 0
                      ? 'text-rose-400'
                      : 'text-zinc-300'
                }`}
              >
                {formatSigned(summary.nets[detailFriend.id] ?? 0)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {(summary.nets[detailFriend.id] ?? 0) > 0
                  ? `${detailFriend.name} owes you`
                  : (summary.nets[detailFriend.id] ?? 0) < 0
                    ? `You owe ${detailFriend.name}`
                    : 'All settled'}
              </p>
            </div>

            <h2 className="mb-1 mt-5 px-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Ledger ({ledger.length})
            </h2>

            {ledger.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
                No shared bills or settlements yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                {ledger.map(({ tx, effect, running }) => {
                  const info = describeEntry(tx, detailFriend.name, categoryById, effect);
                  return (
                    <button
                      key={tx.id}
                      type="button"
                      onClick={() => {
                        if (tx.type !== 'opening') setEditTx(tx);
                      }}
                      className="flex w-full items-start gap-3 border-b border-zinc-800/60 px-4 py-3 text-left last:border-b-0 transition active:bg-zinc-800/50"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400">
                        {info.isCategory ? (
                          <CategoryIcon name={info.icon} className="h-4 w-4" />
                        ) : info.title.startsWith('Settlement') || info.title === 'Initial Balance' ? (
                          <HandCoins className="h-4 w-4" />
                        ) : (
                          <Undo2 className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-200">{info.title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{info.sub}</span>
                        <span className="mt-0.5 block text-[10px] tabular-nums text-zinc-600">
                          {formatDateTime(tx.ts)}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-right">
                        <span
                          className={`block text-sm font-bold tabular-nums ${
                            effect > 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatSigned(effect)}
                        </span>
                        <span className="mt-0.5 block text-[10px] tabular-nums text-zinc-600">
                          bal {formatSigned(running)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Add friend */}
      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          resetAddFriendForm();
        }}
        title="Add Friend"
        footer={
          <button
            type="button"
            onClick={handleAddFriend}
            disabled={!newName.trim()}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-zinc-950 transition disabled:opacity-40"
          >
            Add Friend
          </button>
        }
      >
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Name</label>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
          placeholder="Friend's name"
          maxLength={40}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-600"
        />

        <label
          htmlFor="friend-initial-balance"
          className="mb-1 mt-4 block text-[11px] font-medium uppercase tracking-wider text-zinc-500"
        >
          Initial Balance (₹) — optional
        </label>
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 px-3 focus-within:border-emerald-600">
          <span className="text-sm font-semibold text-zinc-500">₹</span>
          <input
            id="friend-initial-balance"
            inputMode="decimal"
            placeholder="0"
            value={initialAmount}
            onChange={(e) => setInitialAmount(e.target.value)}
            className="w-full bg-transparent px-2 py-2.5 text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 outline-none"
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setInitialDirection('owes_me')}
            className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition ${
              initialDirection === 'owes_me'
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
            }`}
          >
            They owe me
          </button>
          <button
            type="button"
            onClick={() => setInitialDirection('i_owe')}
            className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition ${
              initialDirection === 'i_owe'
                ? 'border-rose-500 bg-rose-500/10 text-rose-400'
                : 'border-zinc-800 bg-zinc-800/40 text-zinc-400'
            }`}
          >
            I owe them
          </button>
        </div>

        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[11px] leading-snug text-zinc-500">
          {initialMagnitude > 0 ? (
            <>
              Ledger opens at{' '}
              <span className={`font-semibold ${signedInitial > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatSigned(signedInitial)}
              </span>
              .{' '}
            </>
          ) : null}
          Migrates a pre-app debt into the peer ledger only — it never touches your account balances, Today's
          Spend or the monthly budget.
        </p>
      </Modal>

      <SettleModal
        open={!!settleFor}
        friendId={settleFor}
        onClose={() => setSettleFor(null)}
      />
      <ForgiveModal
        open={!!forgiveFor}
        friendId={forgiveFor}
        onClose={() => setForgiveFor(null)}
      />

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
