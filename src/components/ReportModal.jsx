import { useEffect, useState } from 'react';
import { FileText, CalendarRange } from 'lucide-react';
import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';
import { dateKey } from '../lib/selectors.js';
import { transactionsInRange, buildFinancialReport } from '../lib/report.js';
import { downloadFile } from '../lib/exporters.js';

const dateInputCls =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5 text-sm font-medium tabular-nums text-zinc-100 outline-none transition focus:border-emerald-600 [color-scheme:dark]';

/**
 * Date-range picker for the Markdown financial report.
 * Entirely client-side: the .md file is built from template literals and
 * downloaded through a Blob — no PDF/document libraries.
 */
export default function ReportModal({ open, onClose }) {
  const { state } = useApp();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');

  // Default window: first day of the current month → today.
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setStartDate(dateKey(new Date(now.getFullYear(), now.getMonth(), 1)));
    setEndDate(dateKey(now.getTime()));
    setError('');
  }, [open]);

  const canGenerate = Boolean(startDate && endDate);

  const changeStart = (value) => {
    setStartDate(value);
    setError('');
  };

  const changeEnd = (value) => {
    setEndDate(value);
    setError('');
  };

  const handleGenerate = () => {
    if (!canGenerate) return;
    // Filter the master list first — no data means no file, just a clear error.
    if (transactionsInRange(state, startDate, endDate).length === 0) {
      setError('No data found for this selected period.');
      return;
    }
    const markdown = buildFinancialReport(state, startDate, endDate);
    downloadFile(
      `financial-report_${startDate}_to_${endDate}.md`,
      markdown,
      'text/markdown;charset=utf-8',
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate Financial Report"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800/60 py-3 text-sm font-semibold text-zinc-300 transition active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-bold text-zinc-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileText className="h-4 w-4" />
            Generate
          </button>
        </div>
      }
    >
      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-500">
        <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
        <span>
          Pick a period — the report covers spend, overheads, category breakdown,
          outstanding friend balances and every transaction inside it. The file is
          generated on-device as Markdown.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="report-start-date" className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Start Date
          </label>
          <input
            id="report-start-date"
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => changeStart(e.target.value)}
            className={dateInputCls}
          />
        </div>
        <div>
          <label htmlFor="report-end-date" className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            End Date
          </label>
          <input
            id="report-end-date"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => changeEnd(e.target.value)}
            className={dateInputCls}
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs font-semibold text-rose-400"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
