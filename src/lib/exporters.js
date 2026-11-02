// JSON backup / restore and CSV export helpers.

import { ACCOUNT_LABELS, MISC_CATEGORY_ID } from './defaults.js';
import { personalSpendOf, formatDateTime, monthKeyOf } from './selectors.js';
import { round2 } from './money.js';

export const BACKUP_FORMAT = 'expense-tracker-backup';
export const BACKUP_VERSION = 1;

export function serializeBackup(state) {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: state,
    },
    null,
    2,
  );
}

/**
 * Validate an imported backup payload and return the app state to load.
 * Throws with a human-readable message on anything unexpected.
 */
export function parseBackup(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  // Accept either the wrapped backup format or a bare state object.
  const data = payload?.format === BACKUP_FORMAT ? payload.data : payload;
  if (!data || typeof data !== 'object') throw new Error('Backup file has no data.');
  if (!Array.isArray(data.transactions)) throw new Error('Backup is missing transactions.');
  if (!Array.isArray(data.categories) || data.categories.length === 0) {
    throw new Error('Backup is missing categories.');
  }
  if (!Array.isArray(data.friends)) throw new Error('Backup is missing friends.');
  if (!data.settings || typeof data.settings !== 'object') throw new Error('Backup is missing settings.');

  return {
    version: Number(data.version) || 1,
    settings: {
      budget: round2(Number(data.settings.budget) || 0),
      startingBalances: {
        upi: round2(Number(data.settings.startingBalances?.upi) || 0),
        upiLite: round2(Number(data.settings.startingBalances?.upiLite) || 0),
        cash: round2(Number(data.settings.startingBalances?.cash) || 0),
      },
    },
    categories: data.categories.map((c, i) => ({
      id: String(c.id),
      name: String(c.name ?? 'Category'),
      icon: String(c.icon ?? 'Shapes'),
      excludeFromBarChart: Boolean(c.excludeFromBarChart),
      order: Number.isFinite(c.order) ? c.order : i,
    })),
    friends: data.friends.map((f) => ({
      id: String(f.id),
      name: String(f.name ?? 'Friend'),
      createdAt: Number(f.createdAt) || Date.now(),
    })),
    transactions: data.transactions.map((t) => ({ ...t, id: String(t.id), ts: Number(t.ts) })),
  };
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per transaction — friendly for spreadsheets. */
export function buildCSV(state) {
  const catById = new Map(state.categories.map((c) => [c.id, c]));
  const friendById = new Map(state.friends.map((f) => [f.id, f]));

  const header = [
    'Date',
    'Time',
    'Type',
    'Category',
    'Note',
    'Account',
    'Cash Flow (INR)',
    'Your Spend (INR)',
    'Counterparty',
    'Details',
  ];

  const rows = [...state.transactions]
    .sort((a, b) => a.ts - b.ts)
    .map((tx) => {
      const d = new Date(tx.ts);
      const date = d.toLocaleDateString('en-CA');
      const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const spend = personalSpendOf(tx);
      let type = 'Expense';
      let category = '';
      let account = '';
      let cashFlow = 0;
      let counterparty = '';
      let details = tx.note || '';

      if (tx.type === 'expense') {
        category = catById.get(tx.categoryId)?.name ?? '';
        if (tx.paidBy === 'friend') {
          type = 'Expense (friend paid)';
          counterparty = friendById.get(tx.friendId)?.name ?? '';
          cashFlow = 0;
          details = details || `Friend paid; your share ₹${tx.yourShare}`;
        } else {
          account = ACCOUNT_LABELS[tx.accountId] ?? tx.accountId;
          cashFlow = -round2(tx.amount);
          if (tx.split?.shares) {
            const parts = tx.split.shares
              .map((s) => `${s.who === 'you' ? 'You' : friendById.get(s.who)?.name ?? s.who}: ₹${s.amount}`)
              .join(' | ');
            details = details ? `${details} — split: ${parts}` : `split: ${parts}`;
          }
        }
      } else if (tx.type === 'transfer') {
        type = 'Transfer (internal)';
        account = `${ACCOUNT_LABELS[tx.from]} → ${ACCOUNT_LABELS[tx.to]}`;
        cashFlow = 0;
      } else if (tx.type === 'income') {
        type = 'Add balance / income';
        account = ACCOUNT_LABELS[tx.accountId] ?? tx.accountId;
        cashFlow = round2(tx.amount);
      } else if (tx.type === 'settlement') {
        type = tx.direction === 'received' ? 'Settle (received)' : 'Settle (paid)';
        account = ACCOUNT_LABELS[tx.accountId] ?? tx.accountId;
        counterparty = friendById.get(tx.friendId)?.name ?? '';
        cashFlow = tx.direction === 'received' ? round2(tx.amount) : -round2(tx.amount);
      } else if (tx.type === 'forgive') {
        type = 'Forgiven debt';
        category = catById.get(tx.categoryId)?.name ?? catById.get(MISC_CATEGORY_ID)?.name ?? 'Miscellaneous';
        counterparty = friendById.get(tx.friendId)?.name ?? '';
        cashFlow = 0;
      }

      return [
        date,
        time,
        type,
        category,
        tx.note || '',
        account,
        cashFlow.toFixed(2),
        spend.toFixed(2),
        counterparty,
        details,
      ]
        .map(csvCell)
        .join(',');
    });

  return [header.join(','), ...rows].join('\n');
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportJSON(state) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`expense-tracker-backup-${stamp}.json`, serializeBackup(state), 'application/json');
}

export function exportCSV(state) {
  const stamp = monthKeyOf(Date.now());
  downloadFile(`expense-tracker-transactions-${stamp}.csv`, buildCSV(state), 'text/csv;charset=utf-8');
}
