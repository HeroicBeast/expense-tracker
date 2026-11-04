// Audit log + starting-balance safeguards: reducer-level guarantees for the
// three triggers (edit / delete / balance change), exact spec strings, and
// backup round-tripping of the new `auditLog` state key.
import { describe, it, expect } from 'vitest';
import { createInitialState, ACCOUNTS } from '../src/lib/defaults.js';
import { reducer } from '../src/store/AppContext.jsx';
import {
  AUDIT_ACTIONS,
  makeAuditEntry,
  withAuditEntries,
  describeTransactionEdit,
  describeTransactionContent,
  describeBalanceChange,
} from '../src/lib/audit.js';
import { serializeBackup, parseBackup } from '../src/lib/exporters.js';

function stateWithExpense(overrides = {}) {
  const s = createInitialState();
  s.transactions.push({
    id: 'tx1',
    ts: Date.now(),
    type: 'expense',
    paidBy: 'you',
    accountId: 'upi',
    amount: 500,
    categoryId: 'food',
    note: '',
    ...overrides,
  });
  return s;
}

describe('audit description helpers (exact spec strings)', () => {
  it('formats a balance change exactly like the spec example', () => {
    expect(describeBalanceChange('upi', 0, 5000)).toBe(
      'Changed UPI starting balance from ₹0 to ₹5,000',
    );
    // All three accounts are covered with their Settings labels.
    for (const acc of ACCOUNTS) {
      expect(describeBalanceChange(acc.id, 0, 100)).toContain(`${acc.label} starting balance`);
    }
  });

  it('formats an amount edit exactly like the spec example', () => {
    const s = stateWithExpense();
    const desc = describeTransactionEdit(s.transactions[0], { ...s.transactions[0], amount: 450 }, s.categories);
    expect(desc).toBe('Edited transaction: Changed amount from ₹500 to ₹450');
  });

  it('formats a delete exactly like the spec example', () => {
    const s = stateWithExpense({ amount: 200, categoryId: 'food' });
    expect(describeTransactionContent(s.transactions[0], s.categories)).toBe('₹200 for Food');
  });

  it('returns an empty string when an edit changed nothing', () => {
    const s = stateWithExpense();
    expect(describeTransactionEdit(s.transactions[0], { ...s.transactions[0] }, s.categories)).toBe('');
  });

  it('describes category and note changes too', () => {
    const s = stateWithExpense({ note: 'Lunch' });
    const next = { ...s.transactions[0], categoryId: 'travel', note: 'Dinner' };
    const desc = describeTransactionEdit(s.transactions[0], next, s.categories);
    expect(desc).toContain('Changed category from Food to Travel');
    expect(desc).toContain('Changed note from "Lunch" to "Dinner"');
    expect(desc.startsWith('Edited transaction: ')).toBe(true);
  });
});

describe('reducer audit triggers', () => {
  it('appends an entry when a past transaction is edited', () => {
    const s = stateWithExpense();
    const next = reducer(s, {
      type: 'UPDATE_TRANSACTION',
      transaction: { ...s.transactions[0], amount: 450 },
    });

    expect(next.transactions[0].amount).toBe(450);
    expect(next.auditLog).toHaveLength(1);
    const [entry] = next.auditLog;
    expect(entry.action).toBe(AUDIT_ACTIONS.EDIT);
    expect(entry.description).toBe('Edited transaction: Changed amount from ₹500 to ₹450');
    expect(typeof entry.ts).toBe('number');
    // Indian day-first timestamp, e.g. "03 Nov 2026, 9:15 pm".
    expect(entry.time).toMatch(/\d{2} \w{3} \d{4}, \d{1,2}:\d{2}/);
  });

  it('does not append an entry when the edit is a no-op', () => {
    const s = stateWithExpense();
    const next = reducer(s, { type: 'UPDATE_TRANSACTION', transaction: { ...s.transactions[0] } });
    expect(next.auditLog ?? []).toHaveLength(0);
  });

  it('appends an entry when a transaction is deleted', () => {
    const s = stateWithExpense({ amount: 200 });
    const next = reducer(s, { type: 'DELETE_TRANSACTION', id: 'tx1' });

    expect(next.transactions).toHaveLength(0);
    expect(next.auditLog).toHaveLength(1);
    expect(next.auditLog[0].action).toBe(AUDIT_ACTIONS.DELETE);
    expect(next.auditLog[0].description).toBe('Deleted transaction: ₹200 for Food');
  });

  it('appends an entry when a starting balance changes', () => {
    const s = createInitialState();
    const next = reducer(s, { type: 'UPDATE_SETTINGS', patch: { startingBalances: { upi: 5000 } } });

    expect(next.settings.startingBalances.upi).toBe(5000);
    expect(next.auditLog).toHaveLength(1);
    expect(next.auditLog[0].action).toBe(AUDIT_ACTIONS.BALANCE);
    expect(next.auditLog[0].description).toBe('Changed UPI starting balance from ₹0 to ₹5,000');
  });

  it('ignores budget-only settings updates and unchanged balances', () => {
    const s = createInitialState();
    const budget = reducer(s, { type: 'UPDATE_SETTINGS', patch: { budget: 30000 } });
    expect(budget.auditLog ?? []).toHaveLength(0);

    const same = reducer(s, { type: 'UPDATE_SETTINGS', patch: { startingBalances: { upi: 0 } } });
    expect(same.auditLog ?? []).toHaveLength(0);
  });

  it('stays safe on legacy states that predate the auditLog key', () => {
    const legacy = stateWithExpense();
    delete legacy.auditLog;

    const next = reducer(legacy, { type: 'DELETE_TRANSACTION', id: 'tx1' });
    expect(next.auditLog).toHaveLength(1);
    expect(next.auditLog[0].description).toBe('Deleted transaction: ₹500 for Food');
  });

  it('never logs internal money movements (add, transfer, settlement)', () => {
    const s = createInitialState();
    const added = reducer(s, {
      type: 'ADD_TRANSACTION',
      transaction: { id: 'tx9', ts: Date.now(), type: 'expense', amount: 100, accountId: 'upi', paidBy: 'you', categoryId: 'food' },
    });
    expect(added.auditLog ?? []).toHaveLength(0);
  });
});

describe('audit helpers', () => {
  it('makeAuditEntry produces a uniquely identified, pre-formatted entry', () => {
    const a = makeAuditEntry(AUDIT_ACTIONS.EDIT, 'Edited transaction: x');
    const b = makeAuditEntry(AUDIT_ACTIONS.EDIT, 'Edited transaction: x');
    expect(a.id).not.toBe(b.id);
    expect(a.time).toMatch(/\d{2} \w{3} \d{4}/);
    expect(a.description).toBe('Edited transaction: x');
  });

  it('withAuditEntries appends chronologically and tolerates missing keys', () => {
    const state = {};
    const one = withAuditEntries(state, [makeAuditEntry(AUDIT_ACTIONS.EDIT, 'first')]);
    const two = withAuditEntries(one, [makeAuditEntry(AUDIT_ACTIONS.DELETE, 'second')]);
    expect(two.auditLog.map((e) => e.description)).toEqual(['first', 'second']);
  });
});

describe('duplicate (swipe) trigger', () => {
  it('clones the transaction with a fresh id, "now" timestamp, the verbatim note and an audit entry', () => {
    const s = stateWithExpense({ note: 'Weekly groceries' });
    const before = s.transactions[0];
    const startedAt = Date.now();
    const next = reducer(s, { type: 'DUPLICATE_TRANSACTION', id: 'tx1' });

    expect(next.transactions).toHaveLength(2);
    const [orig, copy] = next.transactions;
    expect(orig).toBe(before); // original untouched
    expect(copy.id).not.toBe('tx1');
    expect(copy.id).toMatch(/^tx_/);
    expect(copy.amount).toBe(500);
    expect(copy.categoryId).toBe('food');
    expect(copy.accountId).toBe('upi');
    expect(copy.paidBy).toBe('you');
    expect(copy.ts).toBeGreaterThanOrEqual(startedAt); // dated right now
    expect(copy.note).toBe('Weekly groceries'); // inherited verbatim — no "(Copy)" suffix

    expect(next.auditLog).toHaveLength(1);
    expect(next.auditLog[0].action).toBe('duplicate');
    expect(next.auditLog[0].description).toBe(
      'Duplicated transaction via swipe: Food - ₹500',
    );
  });

  it('inherits split logic exactly and leaves an empty note empty', () => {
    const s = stateWithExpense({
      note: '',
      split: { mode: 'equal', shares: [{ who: 'you', amount: 300 }, { who: 'f1', amount: 200 }] },
    });
    const next = reducer(s, { type: 'DUPLICATE_TRANSACTION', id: 'tx1' });
    expect(next.transactions[1].split).toEqual(s.transactions[0].split);
    expect(next.transactions[1].note).toBe('');
  });

  it('is a safe no-op for an unknown id', () => {
    const s = stateWithExpense();
    const next = reducer(s, { type: 'DUPLICATE_TRANSACTION', id: 'nope' });
    expect(next).toBe(s);
  });

  it('labels non-category transactions sensibly in the audit line', () => {
    const s = createInitialState();
    s.transactions.push({
      id: 'tx_t',
      ts: Date.now(),
      type: 'transfer',
      from: 'upi',
      to: 'cash',
      amount: 500,
    });
    const next = reducer(s, { type: 'DUPLICATE_TRANSACTION', id: 'tx_t' });
    expect(next.auditLog[0].description).toBe(
      'Duplicated transaction via swipe: Transfer - ₹500',
    );
  });
});

describe('forgiveness audit (both directions)', () => {
  const forgiveTx = (over = {}) => ({
    id: 'fg1',
    ts: Date.now(),
    type: 'forgive',
    amount: 50,
    friendId: 'f1',
    categoryId: 'miscellaneous',
    note: '',
    ...over,
  });

  it('records "Forgave ₹50 owed by friend" when you forgive their debt', () => {
    const s = createInitialState();
    const next = reducer(s, {
      type: 'ADD_TRANSACTION',
      transaction: forgiveTx({ direction: 'owed_by_friend' }),
    });
    expect(next.auditLog).toHaveLength(1);
    expect(next.auditLog[0].action).toBe('forgive');
    expect(next.auditLog[0].description).toBe('Forgave ₹50 owed by friend');
  });

  it('records "Friend forgave ₹50 owed by you" when they forgive yours', () => {
    const s = createInitialState();
    const next = reducer(s, {
      type: 'ADD_TRANSACTION',
      transaction: forgiveTx({ direction: 'owed_by_you' }),
    });
    expect(next.auditLog).toHaveLength(1);
    expect(next.auditLog[0].action).toBe('forgive');
    expect(next.auditLog[0].description).toBe('Friend forgave ₹50 owed by you');
  });

  it('treats legacy forgiveness records (no direction field) as "you forgave them"', () => {
    const s = createInitialState();
    const next = reducer(s, { type: 'ADD_TRANSACTION', transaction: forgiveTx() });
    expect(next.auditLog[0].description).toBe('Forgave ₹50 owed by friend');
  });
});

describe('backup round-trip', () => {
  it('preserves the audit log through serialize/parse', () => {
    const s = stateWithExpense();
    const withLog = reducer(s, {
      type: 'UPDATE_TRANSACTION',
      transaction: { ...s.transactions[0], amount: 450 },
    });
    const restored = parseBackup(serializeBackup(withLog));
    expect(restored.auditLog).toEqual(withLog.auditLog);
  });

  it('normalises backups that predate the auditLog key to an empty array', () => {
    const s = createInitialState();
    delete s.auditLog;
    const restored = parseBackup(serializeBackup(s));
    expect(restored.auditLog).toEqual([]);
  });
});
