import { useRef, useState } from 'react';
import { ArrowRightLeft, Wallet, HandCoins, Undo2, Copy } from 'lucide-react';
import CategoryIcon from './CategoryIcon.jsx';
import { formatINR, round2 } from '../lib/money.js';
import { formatDateTime } from '../lib/selectors.js';
import { ACCOUNT_LABELS } from '../lib/defaults.js';

const Badge = ({ children }) => (
  <span className="inline-flex max-w-[9rem] items-center truncate rounded border border-zinc-700/70 bg-zinc-800/80 px-1.5 py-px text-[10px] font-medium text-zinc-400">
    {children}
  </span>
);

/** Swipe trigger point: 30% of the viewport width, never below 80px. */
function swipeThreshold() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 360;
  return Math.max(80, w * 0.3);
}

/**
 * One row of the master transaction list. Every row is tappable to edit
 * (or delete) the underlying record — edits/deletes retroactively recalculate
 * account balances, friend nets and monthly totals because everything derives
 * from this list. Swiping the row to the left (Spotify/Messages style)
 * reveals an emerald Duplicate action and, past the threshold, clones the
 * transaction onto right now.
 */
export default function TransactionRow({ tx, category, friend, onOpen, onDuplicate }) {
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

  // --- Swipe-left-to-duplicate gesture (vanilla touch events) --------------
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef({ active: false, startX: 0, startY: 0, axis: null });
  const offsetRef = useRef(0);
  const crossedRef = useRef(false); // threshold already hit (one haptic per swipe)
  const swipedRef = useRef(false); // swallow the click that follows a swipe

  const applyOffset = (v) => {
    offsetRef.current = v;
    setOffset(v);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    gesture.current = { active: true, startX: t.clientX, startY: t.clientY, axis: null };
    crossedRef.current = false;
    swipedRef.current = false;
    setDragging(true);
    applyOffset(0);
  };

  const handleTouchMove = (e) => {
    const g = gesture.current;
    if (!g.active || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    // Axis lock: yield to vertical scrolling unless clearly horizontal.
    if (g.axis === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        g.active = false;
        setDragging(false);
        return;
      }
      g.axis = 'x';
    }

    const threshold = swipeThreshold();
    const raw = Math.min(0, dx); // leftward drag → negative delta
    // 1:1 tracking up to the threshold, rubber-band resistance past it.
    const next = Math.max(
      raw < -threshold ? -threshold + (raw + threshold) * 0.25 : raw,
      -(threshold + 70),
    );
    applyOffset(next);

    // One light haptic the moment the action locks in.
    if (!crossedRef.current && next <= -threshold) {
      crossedRef.current = true;
      swipedRef.current = true;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(50);
      }
    }
  };

  const handleTouchEnd = () => {
    const fire = crossedRef.current && offsetRef.current <= -swipeThreshold();
    gesture.current.active = false;
    gesture.current.axis = null;
    setDragging(false);
    applyOffset(0); // snap back with the CSS transition
    if (fire) {
      swipedRef.current = true; // make sure the trailing click never opens the editor
      onDuplicate?.();
    }
  };

  const handleClick = (e) => {
    if (swipedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      swipedRef.current = false;
      return;
    }
    onOpen?.();
  };

  // How much of the hidden Duplicate layer is revealed (0 → 1).
  const reveal = Math.min(Math.abs(offset) / swipeThreshold(), 1);

  return (
    <button
      type="button"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="relative w-full touch-pan-y overflow-hidden border-b border-zinc-800/60 text-left transition active:bg-zinc-900/70"
    >
      {/* Hidden action layer, revealed by swiping the row left */}
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-end gap-2 pr-4 text-emerald-400"
        style={{ opacity: reveal }}
      >
        <Copy className="h-5 w-5" />
        <span className="text-xs font-bold uppercase tracking-wide">Duplicate</span>
      </span>

      {/* Row content — slides over the action layer while dragging */}
      <span
        className="flex w-full items-start gap-3 bg-zinc-900 px-4 py-3"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
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
      </span>
    </button>
  );
}
