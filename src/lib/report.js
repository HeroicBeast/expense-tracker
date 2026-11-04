// Markdown financial report generator — 100% client-side: the report is
// assembled from JavaScript template literals and downloaded as a Blob.
// No PDF/document libraries involved.

import {
  dateKey,
  formatDateIndian,
  formatDateKey,
  personalSpendOf,
  rangeSpend,
  sortOldestFirst,
  friendSummary,
} from './selectors.js';
import { ACCOUNT_LABELS, MISC_CATEGORY_ID } from './defaults.js';
import { formatINR, round2 } from './money.js';

/** All transactions whose local calendar date falls inside [startKey, endKey]. */
export function transactionsInRange(state, startKey, endKey) {
  return state.transactions.filter((tx) => {
    const key = dateKey(tx.ts);
    return key >= startKey && key <= endKey;
  });
}

/** One itemized line for the report, shaped per the report blueprint. */
function itemizedLine(tx, categoryById, friendById) {
  const day = formatDateIndian(tx.ts);
  const note = tx.note ? `\n  *Note: ${tx.note}*` : '';

  if (tx.type === 'expense') {
    const category = categoryById.get(tx.categoryId)?.name ?? 'Expense';
    const share = personalSpendOf(tx);
    const via =
      tx.paidBy === 'friend'
        ? `Friend: ${friendById.get(tx.friendId)?.name ?? 'friend'}`
        : ACCOUNT_LABELS[tx.accountId] ?? '—';
    return `- **${day}**: ${category} - ${formatINR(share)} (Paid via ${via})${note}`;
  }
  if (tx.type === 'transfer') {
    return `- **${day}**: Transfer ${ACCOUNT_LABELS[tx.from]} → ${ACCOUNT_LABELS[tx.to]} - ${formatINR(tx.amount)} (Internal, no spend)${note}`;
  }
  if (tx.type === 'income') {
    return `- **${day}**: Add Balance - ${formatINR(tx.amount)} (To ${ACCOUNT_LABELS[tx.accountId]})${note}`;
  }
  if (tx.type === 'settlement') {
    const direction = tx.direction === 'received' ? 'Received' : 'Paid';
    return `- **${day}**: Settle Up - ${formatINR(tx.amount)} (${direction} via ${ACCOUNT_LABELS[tx.accountId]})${note}`;
  }
  if (tx.type === 'forgive') {
    const category = categoryById.get(tx.categoryId)?.name ?? 'Miscellaneous';
    const kind =
      tx.direction === 'received' ? 'Friend forgave debt, no cash flow' : 'Forgiven Debt, no cash flow';
    return `- **${day}**: ${category} - ${formatINR(tx.amount)} (${kind})${note}`;
  }
  return `- **${day}**: ${tx.type} - ${formatINR(tx.amount ?? 0)}${note}`;
}

/**
 * Build the full Markdown report for a date range.
 *
 * Period-scoped: total spend, fixed/variable split, category ranking.
 * Live (current): friend balances — they always reflect the ledger as it
 * stands right now, per the report specification.
 */
export function buildFinancialReport(state, startKey, endKey) {
  const spend = rangeSpend(state, startKey, endKey);
  const categoryById = new Map(state.categories.map((c) => [c.id, c]));
  const friendById = new Map(state.friends.map((f) => [f.id, f]));
  const nets = friendSummary(state).nets;

  // Every category with > ₹0 spend, highest → lowest.
  const ranking = state.categories
    .map((category) => ({ category, amount: round2(spend.byCategory[category.id] ?? 0) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.category.order - b.category.order);

  // Current outstanding peer balances (₹0 balances skipped).
  const outstanding = state.friends
    .map((friend) => ({ friend, net: round2(nets[friend.id] ?? 0) }))
    .filter((row) => row.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const txs = sortOldestFirst(transactionsInRange(state, startKey, endKey));

  const out = [];
  out.push('# Financial Overview Report');
  out.push('');
  out.push(`**Period:** ${formatDateKey(startKey)} to ${formatDateKey(endKey)}`);
  out.push('');

  out.push('## Executive Summary');
  out.push('');
  out.push(`- **Total Personal Spend:** ${formatINR(spend.total)}`);
  out.push('');
  out.push(`- **Fixed Overhead (Rent/Elec/Help):** ${formatINR(spend.overhead)}`);
  out.push('');
  out.push(`- **Variable Spending:** ${formatINR(spend.variable)}`);
  out.push('');

  out.push('## Category Breakdown');
  out.push('');
  if (ranking.length === 0) {
    out.push('- No spending recorded in this period.');
    out.push('');
  } else {
    for (const { category, amount } of ranking) {
      out.push(`- **${category.name}:** ${formatINR(amount)}`);
      out.push('');
    }
  }

  out.push('## Outstanding Friend Balances');
  out.push('');
  if (outstanding.length === 0) {
    out.push('- All settled up — no outstanding balances.');
    out.push('');
  } else {
    for (const { friend, net } of outstanding) {
      const wording = net > 0 ? `Owes You ${formatINR(net)}` : `You Owe ${formatINR(Math.abs(net))}`;
      out.push(`- **${friend.name}:** ${wording}`);
      out.push('');
    }
  }

  out.push('## Itemized Expenses');
  out.push('');
  if (txs.length === 0) {
    out.push('- No transactions in this period.');
    out.push('');
  } else {
    for (const tx of txs) {
      out.push(itemizedLine(tx, categoryById, friendById));
      out.push('');
    }
  }

  return out.join('\n').trimEnd() + '\n';
}
