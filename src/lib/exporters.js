// JSON backup / restore and generic Blob download helpers.

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

/** Trigger a client-side file download from an in-memory string. */
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
