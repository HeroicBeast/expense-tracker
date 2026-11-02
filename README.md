# Expense Tracker — Offline-first PWA

A production-ready, installable Progressive Web App for personal expense
tracking, live multi-account balance management, and two-way Splitwise-style
bill splitting. **100% offline** — every byte lives in IndexedDB on your
device. No accounts, no servers, no tracking.

## Features

- **Ultra-minimal dark UI** (OLED-friendly zinc palette) with a thumb-zone
  bottom nav (`Home · Friends · Analytics · Settings`) and a central `+` FAB.
- **Three live accounts** — `UPI`, `UPI Lite`, `Physical Cash` — with 1-tap
  internal transfers/top-ups that never touch your budget or analytics.
- **Net consumption vs cash flow** — split bills only charge your *share* to
  "Today's Spend" and the monthly budget, while the full amount moves in your
  accounts; friend-paid bills book your share with zero account movement.
- **Splitwise-style offline ledger** — equal / manual / itemized+tax splits,
  automatic mutual netting, partial & lump-sum settlements in either direction
  through any account, a *Forgive / Round Off* action that books the
  forgiven amount as a `Miscellaneous` expense so the books always reconcile,
  and an optional **Initial Balance** when adding a friend to migrate debts
  from before the app existed (ledger-only — it never touches account
  balances, Today's Spend or the monthly budget).
- **Home** — balance pills, hero *Today's Spend*, monthly budget progress,
  last month's variance reference badge, and the complete master transaction
  list (never truncated on month rollover; tap any row to edit or delete with
  full retroactive recalculation, or **swipe right to duplicate** it —
  rubber-banded gesture, haptic lock-in, the copy lands on today's date and
  is written to the audit log).
- **Analytics** — month selector, monthly summary, category horizontal bar
  chart (fixed overheads strictly excluded), daily spend trend with a
  cumulative budget-pace line, and a fixed/variable/remaining breakdown.
- **Settings** — monthly budget, starting balances (saved only after an
  explicit confirmation, since they recalculate live balances), category add /
  rename / reorder / "exclude from bar chart" toggle, 1-tap **JSON
  export/import**, a **View Audit Log** modal (every transaction edit, delete
  and starting-balance change with an Indian-format timestamp and a
  before → after trail, newest first), and a **Markdown financial report
  generator**: pick a date range and get a client-side `.md` report
  (executive summary, category breakdown, outstanding friend balances,
  itemized transactions) — zero document libraries.
- **PWA** — `manifest.json` (standalone, portrait, `#09090B`), generated
  192/512 icons + maskable, and a service worker that caches the app shell for
  instant, zero-connectivity launches on Android Chrome ("Add to Home Screen").

## Tech

React 19 · Vite · Tailwind CSS 4 · Lucide icons · `idb` (IndexedDB) ·
react-router `HashRouter` · Vitest + Testing Library.

All balances, friend nets, budgets and chart series are **derived** from a
single immutable transaction list (`src/lib/selectors.js`), so edits,
deletions, partial settlements, friend-paid splits and debt forgiveness
reconcile mathematically across accounts, budgets and ledgers — proven by the
test suite.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # 24 accounting/derivation tests + 4 UI smoke tests
npm run build    # static export to dist/ (relative asset paths)
npm run preview  # serve the production build
```

## Deploy to GitHub Pages

1. Install the CI workflow (it ships in this repo as a template so any Git
   host accepts it):

   ```bash
   mkdir -p .github/workflows
   cp docs/github-pages-workflow.yml .github/workflows/deploy.yml
   git add .github/workflows/deploy.yml
   git commit -m "Add Pages deploy workflow"
   git push
   ```

2. In the GitHub repo: **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` then tests, builds and deploys `dist/` automatically
   (the workflow runs `npm test` before deploying).

The build uses `base: './'` and `HashRouter`, so the app works from any
sub-path (`https://<user>.github.io/<repo>/`) and refreshes never 404.

## Data

Everything is stored locally (IndexedDB with a localStorage mirror). Use
**Settings → Export JSON Backup** before clearing browser data or switching
devices; **Import JSON Backup** restores the complete state. **Generate
Financial Report** produces a dated Markdown report of any period directly in
the browser (template literals + `Blob` download, nothing leaves the device).
