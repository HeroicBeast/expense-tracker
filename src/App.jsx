import { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext.jsx';
import BottomNav from './components/BottomNav.jsx';
import AddTransactionModal from './components/AddTransactionModal.jsx';
import Home from './screens/Home.jsx';
import Friends from './screens/Friends.jsx';
import Analytics from './screens/Analytics.jsx';
import Settings from './screens/Settings.jsx';

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
  const { hydrated } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState('expense');

  const openAdd = (mode) => {
    setAddMode(mode);
    setAddOpen(true);
  };

  if (!hydrated) return <Splash />;

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 antialiased">
      <main className="pb-24">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <BottomNav onAdd={() => openAdd('expense')} />
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
