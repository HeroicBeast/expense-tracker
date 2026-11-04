import { describe, it, expect } from 'vitest';
import { createInitialState, MISC_CATEGORY_ID } from '../src/lib/defaults.js';
import {
  computeAccountBalances,
  computeFriendBalances,
  personalSpendOf,
  monthSpend,
  todaySpend,
  lastMonthVariance,
  analyticsFor,
  friendLedger,
  friendSummary,
} from '../src/lib/selectors.js';
import { equalShares, computeShares } from '../src/lib/split.js';
import { serializeBackup, parseBackup } from '../src/lib/exporters.js';
import { round2 } from '../src/lib/money.js';

const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();

function baseState() {
  const s = createInitialState();
  s.settings.budget = 20000;
  s.settings.startingBalances = { upi: 10000, upiLite: 2000, cash: 500 };
  return s;
}

function withFriends(state, names) {
  state.friends = names.map((name) => ({ id: `f_${name}`, name, createdAt: 1, startingBalance: 0 }));
  return state;
}

const splitYouPaid = (over = {}) => ({
  id: 'tx_split',
  ts: D(2026, 11, 2, 20),
  type: 'expense',
  paidBy: 'you',
  accountId: 'upi',
  amount: 900,
  categoryId: 'food',
  note: 'dinner',
  split: {
    mode: 'equal',
    shares: [
      { who: 'you', amount: 300 },
      { who: 'f_A', amount: 300 },
      { who: 'f_B', amount: 300 },
    ],
  },
  ...over,
});

describe('account balances (live, derived from cash flows)', () => {
  it('starting balances are the baseline', () => {
    const s = baseState();
    expect(computeAccountBalances(s)).toEqual({ upi: 10000, upiLite: 2000, cash: 500 });
  });

  it('pure personal expense deducts from the paying account only', () => {
    const s = baseState();
    s.transactions = [
      { id: 't1', ts: D(2026, 11, 1), type: 'expense', paidBy: 'you', accountId: 'upiLite', amount: 250, categoryId: 'food', note: '' },
    ];
    const bal = computeAccountBalances(s);
    expect(bal.upiLite).toBe(1750);
    expect(bal.upi).toBe(10000);
    expect(bal.cash).toBe(500);
    expect(personalSpendOf(s.transactions[0])).toBe(250);
  });

  it('split you-paid deducts the FULL cash flow while spend counts only your share', () => {
    const s = withFriends(baseState(), ['A', 'B']);
    s.transactions = [splitYouPaid()];
    const bal = computeAccountBalances(s);
    expect(bal.upi).toBe(9100); // full ₹900 left the account
    const nets = computeFriendBalances(s);
    expect(nets.f_A).toBe(300); // friend owes you
    expect(nets.f_B).toBe(300);
    expect(personalSpendOf(s.transactions[0])).toBe(300); // only ₹300 is consumption
  });

  it('friend-paid split moves NO account balance but books your share as spend', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [
      {
        id: 't2',
        ts: D(2026, 11, 2, 21),
        type: 'expense',
        paidBy: 'friend',
        friendId: 'f_A',
        amount: 600,
        yourShare: 200,
        categoryId: 'food',
        note: '',
      },
    ];
    expect(computeAccountBalances(s)).toEqual({ upi: 10000, upiLite: 2000, cash: 500 });
    expect(personalSpendOf(s.transactions[0])).toBe(200);
    expect(computeFriendBalances(s).f_A).toBe(-200); // you owe them / reduces their debt
  });

  it('internal transfer shifts both accounts with zero budget impact', () => {
    const s = baseState();
    s.transactions = [
      { id: 't3', ts: D(2026, 11, 3), type: 'transfer', from: 'upi', to: 'upiLite', amount: 500, note: '' },
    ];
    const bal = computeAccountBalances(s);
    expect(bal).toEqual({ upi: 9500, upiLite: 2500, cash: 500 });
    expect(personalSpendOf(s.transactions[0])).toBe(0);
    expect(monthSpend(s, '2026-11').total).toBe(0);
  });

  it('income / add balance increases the chosen account without counting as spend', () => {
    const s = baseState();
    s.transactions = [
      { id: 't4', ts: D(2026, 11, 3), type: 'income', accountId: 'cash', amount: 1000, note: 'ATM' },
    ];
    expect(computeAccountBalances(s).cash).toBe(1500);
    expect(personalSpendOf(s.transactions[0])).toBe(0);
  });
});

describe('friend ledger: settlements, netting and forgiveness', () => {
  it('received settlement raises the account, reduces the friend net, books no spend', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [
      { id: 't5', ts: D(2026, 11, 4), type: 'settlement', direction: 'received', amount: 500, accountId: 'upi', friendId: 'f_A', note: '' },
    ];
    const bal = computeAccountBalances(s);
    expect(bal.upi).toBe(10500);
    expect(computeFriendBalances(s).f_A).toBe(-500);
    expect(personalSpendOf(s.transactions[0])).toBe(0);
    expect(monthSpend(s, '2026-11').total).toBe(0);
  });

  it('paid settlement lowers the account, raises the friend net, books no spend', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [
      { id: 't6', ts: D(2026, 11, 4), type: 'settlement', direction: 'paid', amount: 300, accountId: 'cash', friendId: 'f_A', note: '' },
    ];
    const bal = computeAccountBalances(s);
    expect(bal.cash).toBe(200);
    expect(computeFriendBalances(s).f_A).toBe(300);
    expect(monthSpend(s, '2026-11').total).toBe(0);
  });

  it('supports partial and lump-sum settlements that net against existing balances', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [
      splitYouPaid(), // A owes +300
      { id: 'p1', ts: D(2026, 11, 5), type: 'settlement', direction: 'received', amount: 100, accountId: 'upi', friendId: 'f_A', note: 'partial' },
      { id: 'p2', ts: D(2026, 11, 6), type: 'settlement', direction: 'received', amount: 250, accountId: 'upi', friendId: 'f_A', note: 'overpay' },
    ];
    expect(computeFriendBalances(s).f_A).toBe(-50); // fully settled + 50 credit to them
    expect(computeAccountBalances(s).upi).toBe(10000 - 900 + 350);
    // Settlements never pollute the budget:
    expect(monthSpend(s, '2026-11').total).toBe(300);
  });

  it('forgiveness moves the friend net and books a Miscellaneous expense with zero cash flow', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [
      splitYouPaid({
        split: { mode: 'manual', shares: [{ who: 'you', amount: 880 }, { who: 'f_A', amount: 20 }] },
      }),
      {
        id: 'fg1',
        ts: D(2026, 11, 7),
        type: 'forgive',
        amount: 20,
        friendId: 'f_A',
        categoryId: MISC_CATEGORY_ID,
        note: 'Forgiven debt - A',
      },
    ];
    const nets = computeFriendBalances(s);
    expect(nets.f_A).toBe(0); // debt wiped
    const bal = computeAccountBalances(s);
    expect(bal.upi).toBe(10000 - 900); // no cash moved by forgiveness
    const spend = monthSpend(s, '2026-11');
    expect(spend.total).toBe(900); // 880 + 20 forgiven
    expect(spend.byCategory[MISC_CATEGORY_ID]).toBe(20);
  });

  it('a debt the FRIEND forgives is a zero-cashflow ledger adjustment — never spend, never accounts', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [
      {
        id: 'fp1',
        ts: D(2026, 11, 5),
        type: 'expense',
        paidBy: 'friend',
        friendId: 'f_A',
        accountId: 'upi',
        amount: 100,
        yourShare: 100,
        categoryId: 'food',
        note: '',
      },
      {
        id: 'fg_you',
        ts: D(2026, 11, 6),
        type: 'forgive',
        amount: 100,
        friendId: 'f_A',
        categoryId: MISC_CATEGORY_ID,
        note: 'Round off - A',
        direction: 'owed_by_you',
      },
    ];

    // Ledger: your ₹100 debt is wiped — net back to 0.
    expect(computeFriendBalances(s).f_A).toBe(0);

    // Zero cash flow: every account untouched.
    expect(computeAccountBalances(s)).toEqual({ upi: 10000, upiLite: 2000, cash: 500 });

    // NOT a personal expense: only the original friend-paid share counts.
    expect(personalSpendOf(s.transactions[1])).toBe(0);
    const spend = monthSpend(s, '2026-11');
    expect(spend.total).toBe(100);
    expect(spend.byCategory[MISC_CATEGORY_ID] ?? 0).toBe(0); // no Misc booking

    // Ledger running balance: −100 → 0 via the round-off row.
    const ledger = friendLedger(s, 'f_A');
    expect(ledger[ledger.length - 1].running).toBe(0);
  });

  it('initial balance migrates pre-app debt into the ledger ONLY', () => {
    const s = withFriends(baseState(), ['A']);
    s.friends[0].startingBalance = 400;

    // No transactions exist — yet the ledger knows the debt.
    expect(computeFriendBalances(s).f_A).toBe(400);
    // CRITICAL: accounts, budget and Today's Spend are completely untouched.
    expect(computeAccountBalances(s)).toEqual({ upi: 10000, upiLite: 2000, cash: 500 });
    expect(monthSpend(s, '2026-11').total).toBe(0);
    expect(todaySpend(s, D(2026, 11, 5))).toBe(0);
    expect(friendSummary(s).owedToYou).toBe(400);

    // Negative direction: "I owe them".
    const s2 = withFriends(baseState(), ['B']);
    s2.friends[0].startingBalance = -150;
    expect(computeFriendBalances(s2).f_B).toBe(-150);
    expect(friendSummary(s2).youOwe).toBe(150);
    expect(monthSpend(s2, '2026-11').total).toBe(0);

    // New activity stacks on top of the opening balance.
    s.transactions = [
      splitYouPaid({ split: { mode: 'manual', shares: [{ who: 'you', amount: 600 }, { who: 'f_A', amount: 300 }] } }),
    ];
    expect(computeFriendBalances(s).f_A).toBe(700);
    // Budget counts only the split's personal share (₹600 yours) — never the
    // opening balance, which is not a transaction at all.
    expect(monthSpend(s, '2026-11').total).toBe(600);

    // Ledger opens with a synthetic Initial Balance row and runs correctly.
    const ledger = friendLedger(s, 'f_A');
    expect(ledger[0].tx.type).toBe('opening');
    expect(ledger[0].effect).toBe(400);
    expect(ledger[0].running).toBe(400);
    expect(ledger[1].tx.id).toBe('tx_split');
    expect(ledger[1].running).toBe(700);
  });

  it('friend ledger is chronological with a correct running balance', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [
      { id: 's2', ts: D(2026, 11, 6), type: 'settlement', direction: 'received', amount: 100, accountId: 'upi', friendId: 'f_A', note: '' },
      splitYouPaid({
        id: 's1',
        ts: D(2026, 11, 2),
        split: { mode: 'manual', shares: [{ who: 'you', amount: 600 }, { who: 'f_A', amount: 300 }] },
      }),
      { id: 's3', ts: D(2026, 11, 8), type: 'forgive', amount: 50, friendId: 'f_A', categoryId: MISC_CATEGORY_ID, note: '' },
    ];
    const ledger = friendLedger(s, 'f_A');
    expect(ledger.map((e) => e.tx.id)).toEqual(['s1', 's2', 's3']);
    expect(ledger.map((e) => e.running)).toEqual([300, 200, 150]);
    const summary = friendSummary(s);
    expect(summary.owedToYou).toBe(150);
  });
});

describe('retroactive edit / delete recalculation', () => {
  it('deleting a transaction restores balances, friend nets and spend exactly', () => {
    const s = withFriends(baseState(), ['A', 'B']);
    s.transactions = [
      { id: 'e1', ts: D(2026, 11, 1), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 400, categoryId: 'groceries', note: '' },
      splitYouPaid({ id: 'e2', ts: D(2026, 11, 2) }),
      { id: 'e3', ts: D(2026, 11, 3), type: 'transfer', from: 'upiLite', to: 'cash', amount: 300, note: '' },
    ];
    const before = {
      bal: computeAccountBalances(s),
      nets: computeFriendBalances(s),
      spend: monthSpend(s, '2026-11').total,
    };
    expect(before.spend).toBe(700);

    s.transactions = s.transactions.filter((t) => t.id !== 'e2');
    expect(computeAccountBalances(s).upi).toBe(before.bal.upi + 900);
    expect(computeFriendBalances(s).f_A).toBe(0);
    expect(computeFriendBalances(s).f_B).toBe(0);
    expect(monthSpend(s, '2026-11').total).toBe(400);
  });

  it('editing an amount re-derives everything from the single source of truth', () => {
    const s = withFriends(baseState(), ['A']);
    s.transactions = [splitYouPaid()];
    s.transactions[0] = { ...s.transactions[0], amount: 1200, split: { mode: 'manual', shares: [
      { who: 'you', amount: 400 },
      { who: 'f_A', amount: 800 },
    ] } };
    const bal = computeAccountBalances(s);
    expect(bal.upi).toBe(8800);
    expect(personalSpendOf(s.transactions[0])).toBe(400);
    expect(computeFriendBalances(s).f_A).toBe(800);
    expect(monthSpend(s, '2026-11').total).toBe(400);
  });

  it('grand reconciliation: accounts + friends + budget all agree after a mixed sequence', () => {
    const s = withFriends(baseState(), ['A', 'B']);
    s.transactions = [
      { id: 'r1', ts: D(2026, 11, 1, 9), type: 'income', accountId: 'upi', amount: 5000, note: '' },
      { id: 'r2', ts: D(2026, 11, 1, 10), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 1000, categoryId: 'rent', note: '' },
      { id: 'r3', ts: D(2026, 11, 2, 19), type: 'expense', paidBy: 'you', accountId: 'upiLite', amount: 250, categoryId: 'food', note: '' },
      splitYouPaid({ id: 'r4', ts: D(2026, 11, 3, 20) }),
      { id: 'r5', ts: D(2026, 11, 4, 13), type: 'expense', paidBy: 'friend', friendId: 'f_A', amount: 600, yourShare: 200, categoryId: 'drink', note: '' },
      { id: 'r6', ts: D(2026, 11, 5, 18), type: 'settlement', direction: 'received', amount: 300, accountId: 'upi', friendId: 'f_B', note: '' },
      { id: 'r7', ts: D(2026, 11, 6, 11), type: 'transfer', from: 'upi', to: 'cash', amount: 700, note: '' },
      { id: 'r8', ts: D(2026, 11, 7, 21), type: 'forgive', amount: 50, friendId: 'f_A', categoryId: MISC_CATEGORY_ID, note: 'Forgiven debt - A' },
    ];

    const bal = computeAccountBalances(s);
    const nets = computeFriendBalances(s);
    const spend = monthSpend(s, '2026-11');

    // Expected accounts, step by step:
    expect(bal.upi).toBe(round2(10000 + 5000 - 1000 - 900 + 300 - 700));
    expect(bal.upiLite).toBe(round2(2000 - 250));
    expect(bal.cash).toBe(round2(500 + 700));

    // Friend nets: A +300 (split) -200 (their paid bill) -50 (forgiven) = +50
    expect(nets.f_A).toBe(50);
    // B +300 (split) -300 (settled) = 0
    expect(nets.f_B).toBe(0);

    // Personal consumption: 1000 rent + 250 food + 300 split + 200 friend-paid + 50 forgiven
    expect(spend.total).toBe(1800);
    expect(spend.overhead).toBe(1000);
    expect(spend.variable).toBe(800);

    // No money is created out of thin air: Σ balances == starting + net external flows.
    // External flows: +5000 income, −1000 rent, −250 food, −900 split bill, +300 received
    // from B. Transfers are internal; friend-paid and forgiveness move no cash.
    const starting = 10000 + 2000 + 500;
    const totalBal = bal.upi + bal.upiLite + bal.cash;
    expect(totalBal).toBe(round2(starting + 5000 - 1000 - 250 - 900 + 300));
  });
});

describe('month rollover semantics', () => {
  const now = D(2026, 11, 5, 12);

  it('spend resets per calendar month while the master list stays intact', () => {
    const s = baseState();
    s.transactions = [
      { id: 'o1', ts: D(2026, 10, 15, 12), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 900, categoryId: 'food', note: '' },
      { id: 'n1', ts: D(2026, 11, 5, 12), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 300, categoryId: 'food', note: '' },
    ];
    expect(monthSpend(s, '2026-10', { now }).total).toBe(900);
    expect(monthSpend(s, '2026-11', { now }).total).toBe(300);
    expect(todaySpend(s, now)).toBe(300); // the October tx never leaks into "today"
    expect(s.transactions).toHaveLength(2); // history never dropped
  });

  it('last month variance is a pure reference metric', () => {
    const s = baseState();
    s.settings.budget = 1000;
    s.transactions = [
      { id: 'o1', ts: D(2026, 10, 10, 12), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 600, categoryId: 'food', note: '' },
    ];
    const v = lastMonthVariance(s, now);
    expect(v.hasData).toBe(true);
    expect(v.diff).toBe(400); // ₹400 under budget
    expect(v.label).toBe('Oct');
    // Current month budget is untouched by last month's numbers:
    expect(monthSpend(s, '2026-11', { now }).total).toBe(0);
  });
});

describe('analytics: overheads excluded from bar chart', () => {
  const now = D(2026, 11, 10, 12);

  it('counts overheads in the budget but strictly excludes them from category ranking', () => {
    const s = baseState();
    s.transactions = [
      { id: 'a1', ts: D(2026, 11, 1, 12), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 8000, categoryId: 'rent', note: '' },
      { id: 'a2', ts: D(2026, 11, 2, 12), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 1200, categoryId: 'electricity', note: '' },
      { id: 'a3', ts: D(2026, 11, 3, 12), type: 'expense', paidBy: 'you', accountId: 'cash', amount: 500, categoryId: 'househelp', note: '' },
      { id: 'a4', ts: D(2026, 11, 4, 12), type: 'expense', paidBy: 'you', accountId: 'upiLite', amount: 900, categoryId: 'food', note: '' },
      { id: 'a5', ts: D(2026, 11, 5, 12), type: 'expense', paidBy: 'you', accountId: 'upiLite', amount: 400, categoryId: 'travel', note: '' },
    ];
    const a = analyticsFor(s, '2026-11', { now });
    expect(a.total).toBe(11000);
    expect(a.overhead).toBe(9700);
    expect(a.variable).toBe(1300);

    const rankedIds = a.categoryRanking.map((r) => r.category.id);
    expect(rankedIds).not.toContain('rent');
    expect(rankedIds).not.toContain('electricity');
    expect(rankedIds).not.toContain('househelp');
    expect(rankedIds).toContain('food');
    // Ranked highest → lowest:
    expect(a.categoryRanking[0].category.id).toBe('food');
    expect(a.categoryRanking[0].amount).toBe(900);
    expect(a.categoryRanking[1].category.id).toBe('travel');

    // Daily chart carries variable spend only (day 4 = ₹900 food):
    expect(a.daily.find((d) => d.day === 4).variable).toBe(900);
    expect(a.daily.find((d) => d.day === 1).variable).toBe(0);
    // Cumulative pace includes overheads:
    expect(a.daily.find((d) => d.day === 1).cumulative).toBe(8000);
    expect(a.over).toBe(0);
    expect(a.remaining).toBe(9000);
  });

  it('daily array length matches the active month — never hardcoded to 30', () => {
    const s = baseState();
    expect(analyticsFor(s, '2026-12', { now: D(2026, 12, 15) }).daily).toHaveLength(31);
    expect(analyticsFor(s, '2026-11', { now: D(2026, 11, 15) }).daily).toHaveLength(30);
    expect(analyticsFor(s, '2026-02', { now: D(2026, 2, 10) }).daily).toHaveLength(28); // not a leap year
    expect(analyticsFor(s, '2028-02', { now: D(2028, 2, 10) }).daily).toHaveLength(29); // leap year
    // Last day of the month is present and the day after is not:
    const dec = analyticsFor(s, '2026-12', { now: D(2026, 12, 31) }).daily;
    expect(dec[dec.length - 1].day).toBe(31);
    expect(dec.find((d) => d.day === 32)).toBeUndefined();
  });
});

describe('split computation (equal, manual, itemized)', () => {
  it('equal split divides exactly, giving rounding pennies to you', () => {
    const shares = equalShares(100, ['you', 'f_A', 'f_B']);
    expect(shares.reduce((a, s) => a + s.amount, 0)).toBe(100);
    expect(shares[0].amount).toBe(33.34);
    expect(shares[1].amount).toBe(33.33);
    expect(shares[2].amount).toBe(33.33);
  });

  it('equal split of ₹900 across 3 matches the spec example', () => {
    const shares = equalShares(900, ['you', 'f_A', 'f_B']);
    expect(shares.map((s) => s.amount)).toEqual([300, 300, 300]);
  });

  it('manual mode rejects shares that do not sum to the bill', () => {
    const bad = computeShares({
      mode: 'manual',
      amount: 900,
      participants: ['you', 'f_A'],
      manual: { you: '400', f_A: '400' },
    });
    expect(bad.error).toMatch(/short/i);

    const good = computeShares({
      mode: 'manual',
      amount: 900,
      participants: ['you', 'f_A'],
      manual: { you: '400', f_A: '500' },
    });
    expect(good.error).toBeNull();
    expect(good.shares.reduce((a, s) => a + s.amount, 0)).toBe(900);
  });

  it('itemized mode distributes shared tax/delivery proportionally', () => {
    const res = computeShares({
      mode: 'itemized',
      amount: 999, // ignored — bill total derives from items + charges
      participants: ['you', 'f_A'],
      bases: { you: '200', f_A: '100' },
      sharedCharges: '30',
    });
    expect(res.error).toBeNull();
    expect(res.amount).toBe(330); // 300 base + 30 charges
    expect(res.shares.find((s) => s.who === 'you').amount).toBe(220); // 200 + 20
    expect(res.shares.find((s) => s.who === 'f_A').amount).toBe(110); // 100 + 10
    expect(res.shares.reduce((a, s) => a + s.amount, 0)).toBe(330);
  });
});

describe('backup export / import', () => {
  it('round-trips the full state through a JSON backup', () => {
    const s = withFriends(baseState(), ['A', 'B']);
    s.friends[0].startingBalance = 150; // migrated pre-app debt
    s.transactions = [
      splitYouPaid(),
      { id: 'b2', ts: D(2026, 11, 5), type: 'settlement', direction: 'paid', amount: 100, accountId: 'cash', friendId: 'f_A', note: 'x' },
    ];
    const restored = parseBackup(serializeBackup(s));
    expect(restored.settings).toEqual(s.settings);
    expect(restored.friends).toEqual(s.friends);
    expect(restored.categories).toEqual(s.categories);
    expect(restored.transactions).toEqual(s.transactions);
    // Restored state derives identical numbers:
    expect(computeAccountBalances(restored)).toEqual(computeAccountBalances(s));
    expect(computeFriendBalances(restored)).toEqual(computeFriendBalances(s));
  });

  it('rejects garbage backups with a readable error', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/i);
    expect(() => parseBackup('{"foo":1}')).toThrow(/missing transactions/i);
  });
});
