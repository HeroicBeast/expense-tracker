import { ArrowRightLeft, Wallet, HandCoins, UserRound, Undo2 } from 'lucide-react';
import CategoryIcon from './CategoryIcon.jsx';
import { formatINR, round2 } from '../lib/money.js';
import { formatDateTime } from '../lib/selectors.js';
import { ACCOUNT_LABELS, MISC_CATEGORY_ID } from '../lib/defaults.js';

const Badge = ({ children }) => (
  <span className="inline-flex max-w-[9rem] items-center truncate rounded border border-zinc-700/70 bg-zinc-800/80 px-1.5 py-px text-[10px] font-medium text-zinc-400">
    {children}
  </span>
);

/**
 * One row of the master transaction list. Every row is tappable to edit
 * (or delete) the underlying record — edits/deletes retroactively recalculate
 * account balances, friend nets and monthly totals because everything derives
 * from this list.
 */
export default function TransactionRow({ tx, category, friend, onOpen }) {
  let Icon = CategoryIcon;
  let iconName = category?.icon || 'Shapes';
  let title = category?.name || 'Expense';
  let sub = tx.note || '';
  let badge = null;
  let main = '';
  let mainClass = 'text-rose-400';
  let subLine = '';

  if (tx.type === 'expense') {
    if (tx.paidBy === 'friend') {
      title = category?.name || 'Expense';
      badge = 'Friend Paid';
      main = `You: ${formatINR(tx.yourShare ?? 0)}`;
      subLine = `${formatINR(tx.amount)} paid by ${friend?.name || 'friend'}`;
      sub = [tx.note, friend?.name].filter(Boolean).join(' · ');
    } else if (tx.split?.shares?.length) {
      const you = tx.split.shares.find((s) => s.who === 'you');
      const yourShare = round2(you?.amount ?? tx.amount);
      const splitTotal = round2(tx.amount - yourShare);
      badge = ACCOUNT_LABELS[tx.accountId] || 'Account';
      main = `−${formatINR(tx.amount)}`;
      subLine = `You: ${formatINR(yourShare)} · Split: ${formatINR(splitTotal)}`;
      sub = [tx.note, 'Split bill'].filter(Boolean).join(' · ');
    } else {
      badge = ACCOUNT_LABELS[tx.accountId] || 'Account';
      main = `−${formatINR(tx.amount)}`;
      sub = tx.note || '';
    }
  } else if (tx.type === 'transfer') {
    Icon = ArrowRightLeft;
    iconName = null;
    const isTopUp = tx.from === 'upi' && tx.to === 'upiLite';
    const isWithdrawal = tx.from === 'upi' && tx.to === 'cash';
    title = isTopUp ? 'Top-Up' : isWithdrawal ? 'Cash Withdrawal' : 'Transfer';
    badge = `${ACCOUNT_LABELS[tx.from]} → ${ACCOUNT_LABELS[tx.to]}`;
    main = formatINR(tx.amount);
    mainClass = 'text-zinc-200';
    sub = [tx.note, 'Internal · no budget impact'].filter(Boolean).join(' · ');
  } else if (tx.type === 'income') {
    Icon = Wallet;
    iconName = null;
    title = 'Add Balance';
    badge = `to ${ACCOUNT_LABELS[tx.accountId] || '—'}`;
    main = `+${formatINR(tx.amount)}`;
    mainClass = 'text-emerald-400';
    sub = tx.note || 'Income / inflow';
  } else if (tx.type === 'settlement') {
    Icon = HandCoins;
    iconName = null;
    title = 'Settle Up';
    const received = tx.direction === 'received';
    badge = ACCOUNT_LABELS[tx.accountId] || 'Account';
    main = received ? `+${formatINR(tx.amount)}` : `−${formatINR(tx.amount)}`;
    mainClass = received ? 'text-emerald-400' : 'text-rose-400';
    sub = `${received ? 'Received from' : 'Paid to'} ${friend?.name || 'friend'}`;
  } else if (tx.type === 'forgive') {
    Icon = Undo2;
    iconName = null;
    title = 'Forgiven Debt';
    badge = 'No cash flow';
    main = formatINR(tx.amount);
    mainClass = 'text-amber-400';
    sub = tx.note || (friend ? `Forgiven debt - ${friend.name}` : 'Debt forgiveness');
    sub = `${sub} · books as spend`;
  } else {
    main = formatINR(tx.amount || 0);
  }

  const categoryLabel =
    tx.type === 'expense' || tx.type === 'forgive' ? (category?.name ?? '') : '';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 border-b border-zinc-800/60 px-4 py-3 text-left transition active:bg-zinc-900/70"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-300">
        {Icon === CategoryIcon ? (
          <CategoryIcon name={iconName} className="h-4.5 w-4.5" />
        ) : (
          <Icon className="h-4.5 w-4.5" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-zinc-100">{title}</span>
          {badge ? <Badge>{badge}</Badge> : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-zinc-500">
          {[categoryLabel && tx.type === 'forgive' ? categoryLabel : '', sub].filter(Boolean).join(' · ')}
        </span>
        <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-600">{formatDateTime(tx.ts)}</span>
      </span>

      <span className="shrink-0 pt-0.5 text-right">
        <span className={`block text-sm font-semibold tabular-nums ${mainClass}`}>{main}</span>
        {subLine ? <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-500">{subLine}</span> : null}
      </span>
    </button>
  );
}
