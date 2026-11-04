// ---------------------------------------------------------------------------
// System audit log. Every sensitive mutation — transaction edit/delete and
// starting-balance change — appends a human-readable entry to `state.auditLog`
// so the user can always see what changed, when, and from what → to what.
// Entries are stored chronologically; the Settings UI shows them newest first.
// Each entry records the timestamp in raw form (for sorting) plus the Indian
// day-first rendering ("02 Nov 2026, 4:35 pm"), the action type, and a brief
// previous → new state description.
// ---------------------------------------------------------------------------

import { formatINR } from './money.js';
import { formatDateTime } from './selectors.js';
import { ACCOUNT_LABELS, newId } from './defaults.js';

export const AUDIT_ACTIONS = {
  EDIT: 'edit',
  DELETE: 'delete',
  BALANCE: 'balance',
  DUPLICATE: 'duplicate',
  FORGIVE: 'forgive',
};

/** Transaction fields compared to decide whether an edit actually changed anything. */
const COMPARED_FIELDS = [
  'type',
  'amount',
  'categoryId',
  'note',
  'paidBy',
  'friendId',
  'yourShare',
  'accountId',
  'from',
  'to',
  'direction',
  'split',
];

function categoryName(categories, id) {
  if (!id) return null;
  return categories.find((c) => c.id === id)?.name ?? null;
}

/** Build one audit entry: unique id, raw + Indian-formatted time, action, description. */
export function makeAuditEntry(action, description, now = Date.now()) {
  return { id: newId('aud'), ts: now, time: formatDateTime(now), action, description };
}

/** Append entries to `state.auditLog` (tolerates legacy states without the key). */
export function withAuditEntries(state, entries) {
  const log = Array.isArray(state.auditLog) ? state.auditLog : [];
  return { ...state, auditLog: [...log, ...entries] };
}

/**
 * "Edited transaction: Changed amount from ₹500 to ₹450" — lists every
 * human-visible change. Returns '' when the two records are equivalent, so
 * re-saving an untouched form never pollutes the log.
 */
export function describeTransactionEdit(prev, next, categories = []) {
  const changed = COMPARED_FIELDS.filter(
    (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]),
  );
  if (changed.length === 0) return '';

  const parts = [];
  if (changed.includes('amount')) {
    parts.push(`Changed amount from ${formatINR(prev.amount)} to ${formatINR(next.amount)}`);
  }
  if (changed.includes('categoryId')) {
    parts.push(
      `Changed category from ${categoryName(categories, prev.categoryId) || 'None'} to ${
        categoryName(categories, next.categoryId) || 'None'
      }`,
    );
  }
  if (changed.includes('note')) {
    parts.push(`Changed note from "${prev.note || '—'}" to "${next.note || '—'}"`);
  }
  if (parts.length === 0) parts.push('Changed transaction details');
  return `Edited transaction: ${parts.join('; ')}`;
}

/** "₹200 for Food" — the compact previous-state description used by deletes. */
export function describeTransactionContent(tx, categories = []) {
  const amount = formatINR(tx.amount ?? 0);
  if (tx.type === 'transfer') {
    return `${amount} ${ACCOUNT_LABELS[tx.from] || tx.from} → ${ACCOUNT_LABELS[tx.to] || tx.to}`;
  }
  if (tx.type === 'income') {
    return `${amount} income to ${ACCOUNT_LABELS[tx.accountId] || tx.accountId}`;
  }
  if (tx.type === 'settlement') {
    return `${amount} settlement (${tx.direction === 'received' ? 'received' : 'paid'})`;
  }
  const cat = categoryName(categories, tx.categoryId);
  return cat ? `${amount} for ${cat}` : amount;
}

/** "Changed UPI starting balance from ₹0 to ₹5,000". */
export function describeBalanceChange(accountId, from, to) {
  const label = ACCOUNT_LABELS[accountId] || accountId;
  return `Changed ${label} starting balance from ${formatINR(from)} to ${formatINR(to)}`;
}

const TYPE_LABELS = {
  transfer: 'Transfer',
  income: 'Income',
  settlement: 'Settlement',
  forgive: 'Forgiveness',
};

/** "Duplicated transaction via swipe: Food - ₹500" — swipe-duplicate audit line. */
export function describeDuplication(tx, categories = []) {
  const label = categoryName(categories, tx.categoryId) || TYPE_LABELS[tx.type] || 'Transaction';
  return `Duplicated transaction via swipe: ${label} - ${formatINR(tx.amount ?? 0)}`;
}

/**
 * Forgiveness audit line — both directions are recorded distinctly:
 *   "Forgave ₹50 owed by friend"       (direction 'given' → Misc expense)
 *   "Friend forgave ₹50 owed by you"   (direction 'received' → zero-cashflow)
 */
export function describeForgiveness(tx) {
  const amount = formatINR(tx.amount ?? 0);
  return tx.direction === 'received'
    ? `Friend forgave ${amount} owed by you`
    : `Forgave ${amount} owed by friend`;
}
