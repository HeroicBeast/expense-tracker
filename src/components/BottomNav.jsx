import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Users, BarChart3, Settings, Plus } from 'lucide-react';

const TABS = [
  { to: '/', label: 'Home', Icon: Home, end: true },
  { to: '/friends', label: 'Friends', Icon: Users },
  { to: '/analytics', label: 'Analytics', Icon: BarChart3 },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

/**
 * Thumb-zone bottom navigation: 4 tabs + a prominent central (+) FAB
 * that opens the Add Transaction modal from anywhere in the app.
 */
export default function BottomNav({ onAdd }) {
  const itemClass = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
      isActive ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
    }`;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="relative mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((tab, i) => (
          <Fragment key={tab.to}>
            {i === 2 ? <div aria-hidden="true" /> : null}
            <NavLink to={tab.to} end={tab.end} className={itemClass}>
              <tab.Icon className="h-5 w-5" />
              {tab.label}
            </NavLink>
          </Fragment>
        ))}

        <button
          type="button"
          onClick={onAdd}
          aria-label="Add transaction"
          className="absolute left-1/2 top-0 flex h-14 w-14 -translate-x-1/2 -translate-y-5 items-center justify-center rounded-full border-2 border-zinc-950 bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-500/25 transition active:scale-95"
        >
          <Plus className="h-7 w-7" strokeWidth={2.5} />
        </button>
      </div>
      <div className="h-[3.25rem]" />
    </nav>
  );
}
