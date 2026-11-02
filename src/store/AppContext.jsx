import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createInitialState, newId, MISC_CATEGORY_ID } from '../lib/defaults.js';
import { loadStateAsync, loadStateSync, saveState } from '../lib/storage.js';
import { round2 } from '../lib/money.js';
import {
  AUDIT_ACTIONS,
  describeBalanceChange,
  describeTransactionContent,
  describeTransactionEdit,
  makeAuditEntry,
  withAuditEntries,
} from '../lib/audit.js';

const AppContext = createContext(null);

export function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return action.state;

    case 'REPLACE_STATE':
      return action.state;

    case 'ADD_TRANSACTION':
      return { ...state, transactions: [...state.transactions, action.transaction] };

    case 'UPDATE_TRANSACTION': {
      const prev = state.transactions.find((t) => t.id === action.transaction.id);
      const transactions = state.transactions.map((t) =>
        t.id === action.transaction.id ? action.transaction : t,
      );
      if (!prev) return { ...state, transactions };
      // Audit: only when the edit actually changed something meaningful.
      const description = describeTransactionEdit(prev, action.transaction, state.categories);
      if (!description) return { ...state, transactions };
      return withAuditEntries({ ...state, transactions }, [
        makeAuditEntry(AUDIT_ACTIONS.EDIT, description),
      ]);
    }

    case 'DELETE_TRANSACTION': {
      const prev = state.transactions.find((t) => t.id === action.id);
      const transactions = state.transactions.filter((t) => t.id !== action.id);
      if (!prev) return { ...state, transactions };
      const description = `Deleted transaction: ${describeTransactionContent(prev, state.categories)}`;
      return withAuditEntries({ ...state, transactions }, [
        makeAuditEntry(AUDIT_ACTIONS.DELETE, description),
      ]);
    }

    case 'ADD_FRIEND':
      return {
        ...state,
        friends: [
          ...state.friends,
          {
            id: newId('f'),
            name: action.name.trim(),
            createdAt: Date.now(),
            // Signed opening balance: + = they owe you, − = you owe them.
            // Ledger-only seed — never part of the transaction list, so it
            // cannot reach account balances or personal spend.
            startingBalance: round2(Number(action.startingBalance) || 0),
          },
        ],
      };

    case 'RENAME_FRIEND':
      return {
        ...state,
        friends: state.friends.map((f) => (f.id === action.id ? { ...f, name: action.name.trim() } : f)),
      };

    case 'DELETE_FRIEND':
      return { ...state, friends: state.friends.filter((f) => f.id !== action.id) };

    case 'UPDATE_SETTINGS': {
      const next = {
        ...state,
        settings: {
          ...state.settings,
          ...action.patch,
          startingBalances: {
            ...state.settings.startingBalances,
            ...(action.patch.startingBalances || {}),
          },
        },
      };
      // Audit every starting balance that actually changed (budget edits don't log).
      const entries = [];
      for (const [id, value] of Object.entries(action.patch.startingBalances || {})) {
        const from = round2(Number(state.settings.startingBalances?.[id]) || 0);
        const to = round2(Number(value) || 0);
        if (from !== to) {
          entries.push(makeAuditEntry(AUDIT_ACTIONS.BALANCE, describeBalanceChange(id, from, to)));
        }
      }
      return entries.length ? withAuditEntries(next, entries) : next;
    }

    case 'ADD_CATEGORY':
      return {
        ...state,
        categories: [
          ...state.categories,
          {
            id: newId('cat'),
            name: action.name.trim(),
            icon: action.icon || 'Shapes',
            excludeFromBarChart: Boolean(action.excludeFromBarChart),
            order: state.categories.length,
          },
        ],
      };

    case 'UPDATE_CATEGORY':
      return {
        ...state,
        categories: state.categories.map((c) =>
          c.id === action.id ? { ...c, ...action.patch, name: (action.patch.name ?? c.name).trim() } : c,
        ),
      };

    case 'DELETE_CATEGORY':
      return { ...state, categories: state.categories.filter((c) => c.id !== action.id) };

    case 'MOVE_CATEGORY': {
      const sorted = [...state.categories].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === action.id);
      const swap = idx + action.delta;
      if (idx < 0 || swap < 0 || swap >= sorted.length) return state;
      const tmp = sorted[idx];
      sorted[idx] = sorted[swap];
      sorted[swap] = tmp;
      return {
        ...state,
        categories: sorted.map((c, i) => ({ ...c, order: i })),
      };
    }

    default:
      return state;
  }
}

/** Lazily hydrate from the synchronous mirror so the first paint is instant. */
function initReducer() {
  const mirrored = loadStateSync();
  if (mirrored && Array.isArray(mirrored.transactions) && Array.isArray(mirrored.categories)) {
    return mirrored;
  }
  return createInitialState();
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initReducer);
  const [hydrated, setHydrated] = useState(() => loadStateSync() !== null);
  const saveTimer = useRef(null);

  // If the mirror was missing/corrupt, fall back to IndexedDB shortly after mount.
  useEffect(() => {
    let cancelled = false;
    if (loadStateSync() === null) {
      loadStateAsync().then((persisted) => {
        if (!cancelled && persisted && Array.isArray(persisted.transactions)) {
          dispatch({ type: 'HYDRATE', state: persisted });
        }
        if (!cancelled) setHydrated(true);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persistence of every state change.
  useEffect(() => {
    if (!hydrated) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveState(state);
    }, 250);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, hydrated]);

  const actions = useMemo(
    () => ({
      hydrate: (persisted) => dispatch({ type: 'HYDRATE', state: persisted }),
      replaceState: (next) => dispatch({ type: 'REPLACE_STATE', state: next }),

      addTransaction: (tx) =>
        dispatch({ type: 'ADD_TRANSACTION', transaction: { id: newId('tx'), ts: Date.now(), ...tx } }),
      updateTransaction: (tx) => dispatch({ type: 'UPDATE_TRANSACTION', transaction: tx }),
      deleteTransaction: (id) => dispatch({ type: 'DELETE_TRANSACTION', id }),

      addFriend: (name, startingBalance = 0) =>
        dispatch({ type: 'ADD_FRIEND', name, startingBalance }),
      renameFriend: (id, name) => dispatch({ type: 'RENAME_FRIEND', id, name }),
      deleteFriend: (id) => dispatch({ type: 'DELETE_FRIEND', id }),

      updateSettings: (patch) => dispatch({ type: 'UPDATE_SETTINGS', patch }),

      addCategory: (name, opts = {}) => dispatch({ type: 'ADD_CATEGORY', name, ...opts }),
      updateCategory: (id, patch) => dispatch({ type: 'UPDATE_CATEGORY', id, patch }),
      deleteCategory: (id) => dispatch({ type: 'DELETE_CATEGORY', id }),
      moveCategory: (id, delta) => dispatch({ type: 'MOVE_CATEGORY', id, delta }),

      /**
       * Forgive / round off a debt: moves the friend's net balance and books
       * the amount as a personal Miscellaneous expense with zero cash flow.
       */
      forgiveDebt: ({ friendId, amount, categoryId }) => {
        const a = round2(amount);
        if (!(a > 0)) return null;
        const tx = {
          id: newId('tx'),
          ts: Date.now(),
          type: 'forgive',
          amount: a,
          friendId,
          categoryId: categoryId || MISC_CATEGORY_ID,
          note: '',
        };
        dispatch({ type: 'ADD_TRANSACTION', transaction: tx });
        return tx;
      },
    }),
    [],
  );

  const value = useMemo(() => ({ state, hydrated, ...actions }), [state, hydrated, actions]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
