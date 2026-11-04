// ---------------------------------------------------------------------------
// Derivation engine. NOTHING is stored as a running balance: every account
// balance, friend net, daily/monthly total and chart series is computed from
// `settings.startingBalances` + the immutable transaction list. Edits and
// deletions therefore reconcile everywhere automatically.
// ---------------------------------------------------------------------------
import { round2 } from './money.js';
import { ACCOUNT_IDS, MISC_CATEGORY_ID } from './defaults.js';

// ---------------------------------------------------------------- dates ----

const pad = (n) => String(n).padStart(2, '0');

/** Local-time YYYY-MM-DD key for a timestamp. */
export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-time YYYY-MM key for a timestamp. */
export function monthKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function todayKey(now = Date.now()) {
  return dateKey(now);
}

export function currentMonthKey(now = Date.now()) {
  return monthKeyOf(now);
}

/** "2026-11" -> { year, month } (month 1-12). */
export function parseMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m };
}

export function monthLabel(key, style = 'long') {
  const { year, month } = parseMonthKey(key);
  // Indian English: "November 2026" / "Nov" (month names, never MM/DD numbers).
  return new Date(year, month - 1, 1).toLocaleString('en-IN', {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
  });
}

export function shiftMonthKey(key, delta) {
  const { year, month } = parseMonthKey(key);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(key) {
  const { year, month } = parseMonthKey(key);
  return new Date(year, month, 0).getDate();
}

/** "02 Nov 2026" — the standard Indian day-first date format (DD MMM YYYY). */
export function formatDateIndian(ts) {
  return new Date(ts).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Same Indian format from a "YYYY-MM-DD" date key (report period lines etc). */
export function formatDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return String(key);
  return formatDateIndian(new Date(y, m - 1, d));
}

/** "02 Nov 2026, 4:35 pm" — transaction row timestamps, day-first. */
export function formatDateTime(ts) {
  const day = formatDateIndian(ts);
  const time = new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

// ------------------------------------------------------------ transactions ---

/** Newest first (ties broken by id for stability). */
export function sortNewestFirst(txs) {
  return [...txs].sort((a, b) => b.ts - a.ts || String(b.id).localeCompare(String(a.id)));
}

export function sortOldestFirst(txs) {
  return [...txs].sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));
}

/**
 * Your personal-consumption share of a transaction — what counts towards
 * Today's Spend, the Monthly Budget and Analytics.
 */
export function personalSpendOf(tx) {
  if (tx.type === 'forgive') {
    // A debt forgiven BY the friend (they erase what you owe) is a pure
    // ledger adjustment — it must never touch your personal spend/budget.
    return tx.direction === 'owed_by_you' ? 0 : round2(tx.amount);
  }
  if (tx.type !== 'expense') return 0;
  if (tx.paidBy === 'friend') return round2(tx.yourShare ?? 0);
  if (tx.split?.shares?.length) {
    const you = tx.split.shares.find((s) => s.who === 'you');
    return round2(you ? you.amount : tx.amount);
  }
  return round2(tx.amount);
}

/** Cash-flow delta applied to one specific account by a transaction. */
export function accountDelta(tx, accountId) {
  switch (tx.type) {
    case 'expense':
      if (tx.paidBy === 'friend') return 0;
      return tx.accountId === accountId ? -round2(tx.amount) : 0;
    case 'transfer':
      if (tx.from === accountId) return -round2(tx.amount);
      if (tx.to === accountId) return round2(tx.amount);
      return 0;
    case 'income':
      return tx.accountId === accountId ? round2(tx.amount) : 0;
    case 'settlement':
      if (tx.accountId !== accountId) return 0;
      return tx.direction === 'received' ? round2(tx.amount) : -round2(tx.amount);
    case 'forgive':
      return 0;
    default:
      return 0;
  }
}

/** Live balances for UPI / UPI Lite / Physical Cash. */
export function computeAccountBalances(state) {
  const balances = {};
  for (const id of ACCOUNT_IDS) {
    balances[id] = round2(Number(state.settings?.startingBalances?.[id]) || 0);
  }
  for (const tx of state.transactions) {
    for (const id of ACCOUNT_IDS) {
      const d = accountDelta(tx, id);
      if (d !== 0) balances[id] = round2(balances[id] + d);
    }
  }
  return balances;
}

/**
 * Friend net balances. Positive = friend owes you (emerald),
 * negative = you owe friend (rose). A single running net per friend.
 */
export function computeFriendBalances(state) {
  const nets = {};
  // Seed each friend with their migrated opening balance (+ they owe you / − you owe them).
  for (const f of state.friends) nets[f.id] = round2(Number(f.startingBalance) || 0);
  for (const tx of state.transactions) {
    // Effects only apply to friends that still exist in the ledger, so orphan
    // ids from an old backup can never skew the summary totals.
    if (tx.type === 'expense' && tx.paidBy !== 'friend' && tx.split?.shares) {
      for (const s of tx.split.shares) {
        if (s.who === 'you' || !(s.who in nets)) continue;
        nets[s.who] = round2(nets[s.who] + round2(s.amount));
      }
    } else if (tx.type === 'expense' && tx.paidBy === 'friend') {
      if (tx.friendId in nets) nets[tx.friendId] = round2(nets[tx.friendId] - round2(tx.yourShare ?? 0));
    } else if (tx.type === 'settlement') {
      if (tx.friendId in nets) {
        nets[tx.friendId] = round2(
          nets[tx.friendId] + (tx.direction === 'received' ? -round2(tx.amount) : round2(tx.amount)),
        );
      }
    } else if (tx.type === 'forgive') {
      if (tx.friendId in nets) {
        // owed_by_friend (default): their debt shrinks by the amount.
        // owed_by_you: YOUR debt shrinks — the net moves back up toward 0.
        nets[tx.friendId] = round2(
          nets[tx.friendId] + (tx.direction === 'owed_by_you' ? round2(tx.amount) : -round2(tx.amount)),
        );
      }
    }
  }
  return nets;
}

// ---------------------------------------------------------------- spend -----

function categoryMap(state) {
  const map = new Map();
  for (const c of state.categories) map.set(c.id, c);
  return map;
}

/**
 * Personal consumption for a calendar month.
 * - `total`        : everything counted by the monthly budget (incl. overheads)
 * - `variable`     : spend in bar-chart categories
 * - `overhead`     : Rent + Electricity + Househelp (excluded from bar chart)
 * - `byCategory`   : { categoryId: amount } for every category
 * - `byDay`        : { dayOfMonth: variableSpend } for the daily trend chart
 * - `byDayTotal`   : { dayOfMonth: totalSpend }
 */
export function monthSpend(state, monthKey, { now = Date.now() } = {}) {
  const cats = categoryMap(state);
  const result = {
    monthKey,
    total: 0,
    variable: 0,
    overhead: 0,
    byCategory: {},
    byDay: {},
    byDayTotal: {},
    hasData: false,
  };
  for (const tx of state.transactions) {
    if (monthKeyOf(tx.ts) !== monthKey) continue;
    const spend = personalSpendOf(tx);
    if (spend <= 0) continue;
    result.hasData = true;
    result.total = round2(result.total + spend);

    const catId =
      tx.type === 'forgive' ? (tx.categoryId ?? MISC_CATEGORY_ID) : tx.categoryId;
    const cat = catId ? cats.get(catId) : null;
    if (catId) result.byCategory[catId] = round2((result.byCategory[catId] ?? 0) + spend);

    const day = new Date(tx.ts).getDate();
    result.byDayTotal[day] = round2((result.byDayTotal[day] ?? 0) + spend);
    if (cat?.excludeFromBarChart) {
      result.overhead = round2(result.overhead + spend);
    } else {
      result.variable = round2(result.variable + spend);
      result.byDay[day] = round2((result.byDay[day] ?? 0) + spend);
    }
  }
  // Ensure every known category key exists (so charts can render zeros).
  for (const c of state.categories) {
    if (result.byCategory[c.id] === undefined) result.byCategory[c.id] = 0;
  }
  return result;
}

/**
 * Personal consumption for an arbitrary date range (YYYY-MM-DD keys, local
 * time, inclusive) — powers the Markdown financial report.
 * Same semantics as `monthSpend`: your forgiveness of a friend's debt counts
 * (it absorbs the loss), but a debt they forgave YOU never does — nor do
 * transfers/settlements. Overheads are flagged separately from variable spend.
 */
export function rangeSpend(state, startKey, endKey) {
  const cats = categoryMap(state);
  const result = {
    startKey,
    endKey,
    total: 0,
    variable: 0,
    overhead: 0,
    byCategory: {},
    hasData: false,
  };
  for (const tx of state.transactions) {
    const key = dateKey(tx.ts);
    if (key < startKey || key > endKey) continue;
    const spend = personalSpendOf(tx);
    if (spend <= 0) continue;
    result.hasData = true;
    result.total = round2(result.total + spend);

    const catId = tx.type === 'forgive' ? (tx.categoryId ?? MISC_CATEGORY_ID) : tx.categoryId;
    const cat = catId ? cats.get(catId) : null;
    if (catId) result.byCategory[catId] = round2((result.byCategory[catId] ?? 0) + spend);
    if (cat?.excludeFromBarChart) {
      result.overhead = round2(result.overhead + spend);
    } else {
      result.variable = round2(result.variable + spend);
    }
  }
  for (const c of state.categories) {
    if (result.byCategory[c.id] === undefined) result.byCategory[c.id] = 0;
  }
  return result;
}

/** Personal consumption booked today (local time). */
export function todaySpend(state, now = Date.now()) {
  const key = todayKey(now);
  let total = 0;
  for (const tx of state.transactions) {
    if (dateKey(tx.ts) !== key) continue;
    total = round2(total + personalSpendOf(tx));
  }
  return total;
}

/** Strictly a reference metric — never rolled into this month's cap. */
export function lastMonthVariance(state, now = Date.now()) {
  const prevKey = shiftMonthKey(currentMonthKey(now), -1);
  const spend = monthSpend(state, prevKey, { now });
  const budget = round2(state.settings.budget || 0);
  const diff = round2(budget - spend.total); // > 0 under budget
  return {
    monthKey: prevKey,
    label: monthLabel(prevKey, 'short'),
    spent: spend.total,
    budget,
    diff,
    hasData: spend.hasData,
    under: diff >= 0,
    amount: round2(Math.abs(diff)),
  };
}

// ------------------------------------------------------------- analytics ----

/** Everything the Analytics screen needs for a given month. */
export function analyticsFor(state, monthKey, { now = Date.now() } = {}) {
  const spend = monthSpend(state, monthKey, { now });
  const budget = round2(state.settings.budget || 0);
  const cats = categoryMap(state);

  // Variable categories ranked highest → lowest (overheads strictly excluded).
  const categoryRanking = state.categories
    .filter((c) => !c.excludeFromBarChart)
    .map((c) => ({ category: c, amount: round2(spend.byCategory[c.id] ?? 0) }))
    .sort((a, b) => b.amount - a.amount || a.category.order - b.category.order);

  const days = daysInMonth(monthKey);
  const daily = [];
  for (let d = 1; d <= days; d += 1) {
    daily.push({ day: d, variable: round2(spend.byDay[d] ?? 0), total: round2(spend.byDayTotal[d] ?? 0) });
  }
  // Cumulative budget pace (variable + overhead, day by day).
  let cumulative = 0;
  for (const row of daily) {
    cumulative = round2(cumulative + row.total);
    row.cumulative = cumulative;
  }

  const remaining = round2(Math.max(budget - spend.total, 0));
  const over = round2(Math.max(spend.total - budget, 0));
  const lastMonth = lastMonthVariance(state, now);

  return {
    monthKey,
    label: monthLabel(monthKey, 'long'),
    budget,
    total: spend.total,
    variable: spend.variable,
    overhead: spend.overhead,
    remaining,
    over,
    hasData: spend.hasData,
    categoryRanking,
    daily,
    lastMonth,
    maxDailyVariable: Math.max(0, ...daily.map((d) => d.variable)),
  };
}

// --------------------------------------------------------------- friends ----

export function friendById(state, id) {
  return state.friends.find((f) => f.id === id) || null;
}

export function friendSummary(state) {
  const nets = computeFriendBalances(state);
  let owedToYou = 0;
  let youOwe = 0;
  for (const v of Object.values(nets)) {
    if (v > 0) owedToYou = round2(owedToYou + v);
    else youOwe = round2(youOwe + Math.abs(v));
  }
  return { nets, owedToYou, youOwe, net: round2(owedToYou - youOwe) };
}

/** Net-balance effect a transaction has on a friend's ledger. */
export function friendEffectOf(tx, friendId) {
  if (tx.type === 'expense' && tx.paidBy !== 'friend' && tx.split?.shares) {
    const s = tx.split.shares.find((x) => x.who === friendId);
    return s ? round2(s.amount) : 0;
  }
  if (tx.type === 'expense' && tx.paidBy === 'friend') {
    return tx.friendId === friendId ? -round2(tx.yourShare ?? 0) : 0;
  }
  if (tx.type === 'settlement' && tx.friendId === friendId) {
    return tx.direction === 'received' ? -round2(tx.amount) : round2(tx.amount);
  }
  if (tx.type === 'forgive' && tx.friendId === friendId) {
    return tx.direction === 'owed_by_you' ? round2(tx.amount) : -round2(tx.amount);
  }
  return 0;
}

/**
 * Full chronological (oldest → newest) ledger for one friend with a running
 * balance after every entry — every split bill, settlement and forgiveness.
 */
export function friendLedger(state, friendId) {
  const friend = state.friends.find((f) => f.id === friendId);
  const opening = round2(Number(friend?.startingBalance) || 0);
  const entries = [];

  // Synthetic read-only "Initial Balance" row so migrated pre-app debts are
  // visible in the ledger and the running balance starts from the right place.
  if (opening !== 0) {
    entries.push({
      tx: {
        id: `opening_${friendId}`,
        type: 'opening',
        ts: Number(friend?.createdAt) || 0,
        amount: Math.abs(opening),
        friendId,
        note: '',
      },
      effect: opening,
      running: opening,
    });
  }

  let running = opening;
  for (const tx of sortOldestFirst(state.transactions)) {
    const effect = friendEffectOf(tx, friendId);
    if (effect === 0) continue;
    running = round2(running + effect);
    entries.push({ tx, effect, running });
  }
  return entries;
}

/** Transaction rows that involve a given friend (for delete guards etc). */
export function transactionsInvolving(state, friendId) {
  return state.transactions.filter((tx) => friendEffectOf(tx, friendId) !== 0);
}
