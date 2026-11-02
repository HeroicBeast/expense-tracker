// Financial report generator — range filtering, period maths and the exact
// Markdown blueprint output.
import { describe, it, expect } from 'vitest';
import { createInitialState, MISC_CATEGORY_ID } from '../src/lib/defaults.js';
import { rangeSpend } from '../src/lib/selectors.js';
import { transactionsInRange, buildFinancialReport } from '../src/lib/report.js';

const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();

function reportState() {
  const s = createInitialState();
  s.settings.budget = 20000;
  s.friends = [
    { id: 'f_ravi', name: 'Ravi', createdAt: 1 },
    { id: 'f_amit', name: 'Amit', createdAt: 2 },
  ];
  s.transactions = [
    // In range:
    { id: 't1', ts: D(2026, 11, 1), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 8000, categoryId: 'rent', note: 'Nov rent' },
    { id: 't2', ts: D(2026, 11, 3), type: 'expense', paidBy: 'you', accountId: 'upiLite', amount: 500, categoryId: 'food', note: 'lunch' },
    {
      id: 't3',
      ts: D(2026, 11, 5),
      type: 'expense',
      paidBy: 'you',
      accountId: 'upi',
      amount: 900,
      categoryId: 'food',
      note: '',
      split: { mode: 'equal', shares: [{ who: 'you', amount: 300 }, { who: 'f_ravi', amount: 600 }] },
    },
    { id: 't4', ts: D(2026, 11, 7), type: 'expense', paidBy: 'friend', friendId: 'f_ravi', amount: 600, yourShare: 200, categoryId: 'drink', note: 'rooftop bar' },
    { id: 't6', ts: D(2026, 11, 4), type: 'transfer', from: 'upi', to: 'upiLite', amount: 1000, note: '' },
    // Out of range:
    { id: 't5', ts: D(2026, 10, 15), type: 'expense', paidBy: 'you', accountId: 'upi', amount: 777, categoryId: 'travel', note: 'oct trip' },
  ];
  return s;
}

const START = '2026-11-01';
const END = '2026-11-30';

describe('range filtering', () => {
  it('includes only transactions inside the inclusive date range', () => {
    const s = reportState();
    const txs = transactionsInRange(s, START, END);
    expect(txs).toHaveLength(5);
    expect(txs.map((t) => t.id)).not.toContain('t5');
    // Inclusive boundaries:
    expect(transactionsInRange(s, '2026-11-01', '2026-11-01').map((t) => t.id)).toEqual(['t1']);
    expect(transactionsInRange(s, '2026-10-01', '2026-10-31').map((t) => t.id)).toEqual(['t5']);
  });

  it('rangeSpend splits fixed vs variable strictly for the range', () => {
    const s = reportState();
    const spend = rangeSpend(s, START, END);
    // 8000 rent + 500 food + 300 split share + 200 friend-paid share
    expect(spend.total).toBe(9000);
    expect(spend.overhead).toBe(8000);
    expect(spend.variable).toBe(1000);
    expect(spend.byCategory.food).toBe(800);
    expect(spend.byCategory.drink).toBe(200);
    expect(spend.byCategory.rent).toBe(8000);
    expect(spend.hasData).toBe(true);
  });
});

describe('buildFinancialReport (Markdown blueprint)', () => {
  const md = buildFinancialReport(reportState(), START, END);

  it('follows the exact section structure and period line', () => {
    expect(md.startsWith('# Financial Overview Report\n')).toBe(true);
    expect(md).toContain('**Period:** 2026-11-01 to 2026-11-30');
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('## Category Breakdown');
    expect(md).toContain('## Outstanding Friend Balances');
    expect(md).toContain('## Itemized Expenses');
  });

  it('reports the executive summary totals for the range', () => {
    expect(md).toContain('- **Total Personal Spend:** ₹9,000');
    expect(md).toContain('- **Fixed Overhead (Rent/Elec/Help):** ₹8,000');
    expect(md).toContain('- **Variable Spending:** ₹1,000');
  });

  it('lists every > ₹0 category sorted highest to lowest (overheads included)', () => {
    const rentIdx = md.indexOf('- **Rent:** ₹8,000');
    const foodIdx = md.indexOf('- **Food:** ₹800');
    const drinkIdx = md.indexOf('- **Drink:** ₹200');
    expect(rentIdx).toBeGreaterThan(-1);
    expect(foodIdx).toBeGreaterThan(rentIdx);
    expect(drinkIdx).toBeGreaterThan(foodIdx);
    // Categories with zero spend in the period are omitted:
    expect(md).not.toContain('- **Travel:**');
    expect(md).not.toContain('- **Groceries:**');
  });

  it('shows current live friend balances and skips ₹0 nets', () => {
    // Ravi: +600 (split) −200 (their friend-paid bill) = +₹400 live.
    expect(md).toContain('- **Ravi:** Owes You ₹400');
    // Amit never transacted → excluded.
    expect(md).not.toContain('Amit');
  });

  it('itemizes transactions chronologically with date, category, share and account', () => {
    const lines = md.split('\n');
    const idx = (frag) => lines.findIndex((l) => l.includes(frag));
    const order = [
      idx('**2026-11-01**: Rent - ₹8,000 (Paid via UPI)'),
      idx('**2026-11-03**: Food - ₹500 (Paid via UPI Lite)'),
      idx('**2026-11-04**: Transfer UPI → UPI Lite'),
      idx('**2026-11-05**: Food - ₹300 (Paid via UPI)'),
      idx('**2026-11-07**: Drink - ₹200 (Paid via Friend: Ravi)'),
    ];
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Optional note rendered under its bullet:
    expect(md).toContain('  *Note: Nov rent*');
    expect(md).toContain('  *Note: rooftop bar*');
    // The out-of-range October trip never appears:
    expect(md).not.toContain('oct trip');
    expect(md).not.toContain('2026-10-15');
  });

  it('handles a period with no outstanding balances gracefully', () => {
    const s = reportState();
    s.transactions = s.transactions.filter((t) => t.type !== 'expense');
    const clean = buildFinancialReport(s, START, END);
    expect(clean).toContain('- All settled up — no outstanding balances.');
  });
});
