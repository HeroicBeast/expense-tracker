import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Upload,
  FileText,
  Trash2,
  ChevronUp,
  ChevronDown,
  Plus,
  Database,
  History,
} from 'lucide-react';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { useApp } from '../store/AppContext.jsx';
import { ACCOUNTS, MISC_CATEGORY_ID } from '../lib/defaults.js';
import { parseAmount, round2 } from '../lib/money.js';
import { formatDateTime } from '../lib/selectors.js';
import { exportJSON, parseBackup } from '../lib/exporters.js';
import ReportModal from '../components/ReportModal.jsx';
import Modal from '../components/Modal.jsx';

/** Shown before any starting-balance save is allowed to proceed. */
const STARTING_BALANCE_WARNING =
  'Are you sure you want to change your starting balance? This will immediately recalculate your current live balances.';

const AUDIT_BADGES = {
  edit: { label: 'Edit', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-400' },
  delete: { label: 'Delete', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-400' },
  balance: { label: 'Balance', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
  duplicate: { label: 'Duplicate', cls: 'border-violet-500/30 bg-violet-500/10 text-violet-400' },
  forgive: { label: 'Forgive', cls: 'border-orange-500/30 bg-orange-500/10 text-orange-400' },
};

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-zinc-700'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.375rem]' : 'left-0.5'}`}
      />
    </button>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

/** One category row: inline rename (committed on blur), reorder, exclude toggle, delete. */
function CategoryRow({ cat, index, total, onUpdate, onDelete, onMove }) {
  const [name, setName] = useState(cat.name);

  // Re-sync when the store changes underneath us (imports, undo of a delete).
  useEffect(() => {
    setName(cat.name);
  }, [cat.name]);

  const commit = () => {
    const value = name.trim();
    if (value && value !== cat.name) onUpdate(cat.id, { name: value });
    else setName(cat.name); // never allow an empty name
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <CategoryIcon name={cat.icon} className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setName(cat.name);
              e.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-200 outline-none focus:text-zinc-50"
          maxLength={24}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`Move ${cat.name} up`}
            disabled={index === 0}
            onClick={() => onMove(cat.id, -1)}
            className="rounded p-1 text-zinc-500 transition hover:text-zinc-200 disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Move ${cat.name} down`}
            disabled={index === total - 1}
            onClick={() => onMove(cat.id, 1)}
            className="rounded p-1 text-zinc-500 transition hover:text-zinc-200 disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${cat.name}`}
            onClick={() => onDelete(cat)}
            className="rounded p-1 text-zinc-500 transition hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between pl-6">
        <span className="text-[11px] text-zinc-600">Exclude from category bar chart</span>
        <Toggle
          checked={cat.excludeFromBarChart}
          onChange={(checked) => onUpdate(cat.id, { excludeFromBarChart: checked })}
          label={`Exclude ${cat.name} from bar chart`}
        />
      </div>
    </div>
  );
}

export default function Settings() {
  const { state, updateSettings, addCategory, updateCategory, deleteCategory, moveCategory, replaceState } =
    useApp();

  const [budget, setBudget] = useState(() => String(state.settings.budget));
  const [balances, setBalances] = useState(() => ({ ...state.settings.startingBalances }));
  const [newCatName, setNewCatName] = useState('');
  const [newCatOverhead, setNewCatOverhead] = useState(false);
  const [message, setMessage] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const fileRef = useRef(null);
  const messageTimer = useRef(null);

  const categories = useMemo(
    () => [...state.categories].sort((a, b) => a.order - b.order),
    [state.categories],
  );

  // Newest first for the View Audit Log modal. Ties (same millisecond) fall
  // back to insertion order so a just-appended entry always shows on top.
  const auditEntries = useMemo(() => {
    const log = Array.isArray(state.auditLog) ? state.auditLog : [];
    return log
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => b.entry.ts - a.entry.ts || b.index - a.index)
      .map(({ entry }) => entry);
  }, [state.auditLog]);

  const flash = (msg) => {
    setMessage(msg);
    window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(''), 3500);
  };

  const commitBudget = () => {
    const v = parseAmount(budget);
    if (!Number.isFinite(v) || v < 0) {
      setBudget(String(state.settings.budget));
      return;
    }
    updateSettings({ budget: round2(v) });
    setBudget(String(round2(v)));
  };

  const commitBalance = (id, raw) => {
    const current = round2(Number(state.settings.startingBalances[id]) || 0);
    const v = parseAmount(raw);
    if (!Number.isFinite(v)) {
      setBalances((b) => ({ ...b, [id]: String(current) }));
      return;
    }
    const rounded = round2(v);
    if (rounded === current) {
      setBalances((b) => ({ ...b, [id]: String(rounded) })); // untouched → nothing to confirm
      return;
    }
    // Safety net: a starting-balance change immediately recalculates every
    // live balance — only proceed when the user explicitly confirms.
    if (!window.confirm(STARTING_BALANCE_WARNING)) {
      setBalances((b) => ({ ...b, [id]: String(current) })); // revert the edit
      return;
    }
    updateSettings({ startingBalances: { [id]: rounded } });
    setBalances((b) => ({ ...b, [id]: String(rounded) }));
  };

  const handleAddCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      flash('A category with that name already exists.');
      return;
    }
    addCategory(name, { excludeFromBarChart: newCatOverhead, icon: 'Shapes' });
    setNewCatName('');
    setNewCatOverhead(false);
    flash(`Added "${name}".`);
  };

  const handleDeleteCategory = (cat) => {
    if (cat.id === MISC_CATEGORY_ID) {
      flash('Miscellaneous can’t be deleted — it books forgiven debts.');
      return;
    }
    if (
      !window.confirm(
        `Delete "${cat.name}"? Past transactions keep their records but will show without a category in charts.`,
      )
    ) {
      return;
    }
    deleteCategory(cat.id);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const restored = parseBackup(text);
      if (!window.confirm('Importing replaces ALL current data on this device. Continue?')) return;
      replaceState(restored);
      setBudget(String(restored.settings.budget));
      setBalances({ ...restored.settings.startingBalances });
      flash('Backup restored successfully.');
    } catch (err) {
      window.alert(err.message || 'Could not import that file.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-4">
      <h1 className="text-lg font-bold text-zinc-100">Settings</h1>

      {message ? (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-400">
          {message}
        </div>
      ) : null}

      {/* Monthly budget */}
      <Section title="Monthly Budget">
        <label className="mb-1 block text-xs text-zinc-400">Target spend per calendar month</label>
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 focus-within:border-emerald-600">
          <span className="text-sm font-semibold text-zinc-500">₹</span>
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full bg-transparent px-2 py-2.5 text-sm font-bold tabular-nums text-zinc-100 outline-none"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Last month's variance is shown as a reference only — it never rolls into this month's cap.
        </p>
      </Section>

      {/* Starting balances */}
      <Section title="Starting Balances">
        <p className="mb-2 text-[11px] text-zinc-600">
          The opening amount in each account when tracking began. Live balances = starting balance + all cash flows.
        </p>
        <div className="space-y-2">
          {ACCOUNTS.map((acc) => (
            <div key={acc.id} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-zinc-400">{acc.label}</span>
              <div className="flex flex-1 items-center rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 focus-within:border-emerald-600">
                <span className="text-xs text-zinc-600">₹</span>
                <input
                  inputMode="decimal"
                  value={balances[acc.id]}
                  onChange={(e) => setBalances((b) => ({ ...b, [acc.id]: e.target.value }))}
                  onBlur={(e) => commitBalance(acc.id, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full bg-transparent px-2 py-2 text-sm font-semibold tabular-nums text-zinc-100 outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Categories */}
      <Section title="Categories">
        <div className="space-y-1.5">
          {categories.map((cat, idx) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              index={idx}
              total={categories.length}
              onUpdate={updateCategory}
              onDelete={handleDeleteCategory}
              onMove={moveCategory}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
            placeholder="New category name"
            maxLength={24}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-600"
          />
          <button
            type="button"
            onClick={() => setNewCatOverhead((v) => !v)}
            className={`shrink-0 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition ${
              newCatOverhead
                ? 'border-sky-500/50 bg-sky-500/10 text-sky-400'
                : 'border-zinc-800 text-zinc-500'
            }`}
            title="Overhead categories count toward the budget but stay out of bar charts"
          >
            Overhead
          </button>
          <button
            type="button"
            onClick={handleAddCategory}
            disabled={!newCatName.trim()}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-zinc-950 transition disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          Overhead categories (Rent, Electricity, Househelp) count toward your monthly budget but are silently
          excluded from the category bar chart.
        </p>
      </Section>

      {/* Data backup & restore */}
      <Section title="Data Backup & Restore">
        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => exportJSON(state)}
            className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-3 text-sm font-semibold text-emerald-400 transition active:scale-[0.99]"
          >
            <Download className="h-4 w-4" />
            Export JSON Backup
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/50 py-3 text-sm font-semibold text-zinc-200 transition active:scale-[0.99]"
          >
            <Upload className="h-4 w-4" />
            Import JSON Backup
          </button>
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/50 py-3 text-sm font-semibold text-zinc-200 transition active:scale-[0.99]"
          >
            <FileText className="h-4 w-4" />
            Generate Financial Report
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-500">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
          <span>
            Everything lives offline on this device (IndexedDB + local mirror) — no accounts, no servers. Export a
            backup before switching phones or clearing browser data.
          </span>
        </div>
      </Section>

      {/* System audit log */}
      <Section title="Audit Log">
        <p className="mb-2 text-[11px] text-zinc-600">
          Every transaction edit, deletion and starting-balance change is recorded on this device — newest first.
        </p>
        <button
          type="button"
          onClick={() => setAuditOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/50 py-3 text-sm font-semibold text-zinc-200 transition active:scale-[0.99]"
        >
          <History className="h-4 w-4" />
          View Audit Log
        </button>
      </Section>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />

      <Modal open={auditOpen} onClose={() => setAuditOpen(false)} title="Audit Log">
        {auditEntries.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-zinc-400">No changes recorded yet</p>
            <p className="mx-auto mt-1.5 max-w-[22rem] text-xs leading-relaxed text-zinc-600">
              Transaction edits, deletions and starting-balance changes will appear here with a full before → after
              trail.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {auditEntries.map((e) => {
              const badge = AUDIT_BADGES[e.action] || AUDIT_BADGES.edit;
              return (
                <li key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-[11px] tabular-nums text-zinc-500">
                      {e.time || formatDateTime(e.ts)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{e.description}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      <div className="h-6" />
    </div>
  );
}
