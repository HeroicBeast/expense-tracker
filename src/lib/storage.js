// Offline-first persistence: IndexedDB (via `idb`) is the primary store, with a
// synchronous localStorage mirror for instant first paint and as a fallback
// when IndexedDB is unavailable (e.g. strict private modes).

import { openDB } from 'idb';

const DB_NAME = 'expense-tracker';
const DB_VERSION = 1;
const STORE = 'app-state';
const KEY = 'state';
const LS_KEY = 'expense-tracker.state.v1';
const MIRROR_MAX_BYTES = 3_500_000; // stay safely under the ~5MB localStorage quota

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    }).catch(() => {
      dbPromise = null;
      return null; // caller falls back to localStorage
    });
  }
  return dbPromise;
}

/** Synchronous read — used for the very first paint. */
export function loadStateSync() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Async read — authoritative source when the mirror is missing. */
export async function loadStateAsync() {
  try {
    const db = await getDB();
    if (db) {
      const value = await db.get(STORE, KEY);
      if (value && typeof value === 'object') return value;
    }
  } catch {
    /* fall through to localStorage */
  }
  return loadStateSync();
}

function writeMirror(state) {
  try {
    const json = JSON.stringify(state);
    if (json.length <= MIRROR_MAX_BYTES) localStorage.setItem(LS_KEY, json);
    else localStorage.removeItem(LS_KEY); // huge ledgers live in IndexedDB only
  } catch {
    /* quota exceeded — IndexedDB still holds the data */
  }
}

/** Persist the full app state to IndexedDB + the localStorage mirror. */
export async function saveState(state) {
  writeMirror(state);
  try {
    const db = await getDB();
    if (db) await db.put(STORE, state, KEY);
  } catch {
    /* mirror already written */
  }
}
