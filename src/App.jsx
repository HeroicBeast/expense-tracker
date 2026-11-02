import { useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext.jsx';
import BottomNav from './components/BottomNav.jsx';
import AddTransactionModal from './components/AddTransactionModal.jsx';
import Home from './screens/Home.jsx';
import Friends from './screens/Friends.jsx';
import Analytics from './screens/Analytics.jsx';
import Settings from './screens/Settings.jsx';

/** Undo window for a swipe-right delete before it is committed for real. */
const DELETE_UNDO_MS = 4000;

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950">
      <span className="flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl bg-emerald-500 text-2xl font-black text-zinc-950">
        ₹
      </span>
      <p className="text-xs tracking-widest text-zinc-600">LOADING YOUR LEDGER…</p>
    </div>
  );
}

function Shell() {
  const { hydrated, deleteTransaction } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState('expense');
  // Soft delete: the row leaves the UI immediately, but the hard delete (and
  // its audit-log entry) only lands if the undo window expires untouched.
  const [pendingDelete, setPendingDelete] = useState(null); // { tx }
  const deleteTimerRef = useRef(null);

  // Never leave a dangling undo timer behind (unmount / test cleanup).
  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    },
    [],
  );

  const openAdd = (mode) => {
    setAddMode(mode);
    setAddOpen(true);
  };

  const requestDelete = (tx) => {
    // Only one undo window at a time — commit any previous pending delete now.
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    if (pendingDelete) deleteTransaction(pendingDelete.tx.id);

    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      deleteTransaction(tx.id); // hard delete → balances/friends recalc + audit entry
      setPendingDelete(null);
    }, DELETE_UNDO_MS);
    setPendingDelete({ tx }); // optimistic: Home hides it right away
  };

  const undoDelete = () => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setPendingDelete(null); // the tx was never removed from the store → it simply reappears
  };

  if (!hydrated) return <Splash />;

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 antialiased">
      <main className="min-h-[100dvh] pb-24">
        <Routes>
          <Route
            path="/"
            element={<Home pendingDelete={pendingDelete} onRequestDelete={requestDelete} />}
          />
          <Route path="/friends" element={<Friends />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <BottomNav onAdd={() => openAdd('expense')} />

      {/* Undo toast — floats just above the nav + FAB, never blocks either. */}
      {pendingDelete ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[55] flex justify-center px-4">
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-4 rounded-full border border-zinc-700 bg-zinc-800 py-2.5 pl-5 pr-3 shadow-2xl shadow-black/50"
          >
            <span className="text-sm font-medium text-zinc-100">Deleted.</span>
            <button
              type="button"
              onClick={undoDelete}
              className="rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wider text-rose-400 transition hover:text-rose-300 active:scale-95"
            >
              UNDO
            </button>
          </div>
        </div>
      ) : null}

      <AddTransactionModal open={addOpen} initialMode={addMode} onClose={() => setAddOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AppProvider>
  );
}
