// Static app defaults: payment accounts, the 10 pre-loaded categories and
// base settings. Categories carry a hard-coded `excludeFromBarChart` flag for
// overheads (Rent / Electricity / Househelp) — this is a data flag, not a
// user-facing "tag" system.

export const ACCOUNTS = [
  { id: 'upi', label: 'UPI', short: 'UPI', full: 'UPI (Primary Bank)' },
  { id: 'upiLite', label: 'UPI Lite', short: 'Lite', full: 'UPI Lite' },
  { id: 'cash', label: 'Cash', short: 'Cash', full: 'Physical Cash' },
];

export const ACCOUNT_IDS = ACCOUNTS.map((a) => a.id);

export const ACCOUNT_LABELS = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.label]));

/** Accounts that can receive external inflows / top-ups. */
export const INCOME_ACCOUNT_IDS = ['upi', 'cash'];

/** 1-tap internal transfer presets (zero budget / analytics impact). */
export const TRANSFER_PRESETS = [
  { id: 'topup', label: 'UPI → UPI Lite (Top-Up)', from: 'upi', to: 'upiLite' },
  { id: 'withdraw', label: 'UPI → Cash (Withdrawal)', from: 'upi', to: 'cash' },
];

export const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food', icon: 'Utensils', excludeFromBarChart: false, order: 0 },
  { id: 'travel', name: 'Travel', icon: 'Plane', excludeFromBarChart: false, order: 1 },
  { id: 'groceries', name: 'Groceries', icon: 'ShoppingCart', excludeFromBarChart: false, order: 2 },
  { id: 'cigarettes', name: 'Cigarettes', icon: 'Cigarette', excludeFromBarChart: false, order: 3 },
  { id: 'drink', name: 'Drink', icon: 'Wine', excludeFromBarChart: false, order: 4 },
  { id: 'sip', name: 'SIP', icon: 'PiggyBank', excludeFromBarChart: false, order: 5 },
  { id: 'miscellaneous', name: 'Miscellaneous', icon: 'Shapes', excludeFromBarChart: false, order: 6 },
  { id: 'rent', name: 'Rent', icon: 'Home', excludeFromBarChart: true, order: 7 },
  { id: 'electricity', name: 'Electricity', icon: 'Zap', excludeFromBarChart: true, order: 8 },
  { id: 'househelp', name: 'Househelp', icon: 'Users', excludeFromBarChart: true, order: 9 },
];

/** Forgiveness expenses are always booked here; the category cannot be deleted. */
export const MISC_CATEGORY_ID = 'miscellaneous';

export const DEFAULT_SETTINGS = {
  budget: 20000,
  startingBalances: { upi: 0, upiLite: 0, cash: 0 },
};

export function createInitialState() {
  return {
    version: 1,
    settings: {
      budget: DEFAULT_SETTINGS.budget,
      startingBalances: { ...DEFAULT_SETTINGS.startingBalances },
    },
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    friends: [],
    transactions: [],
  };
}

export function newId(prefix = 'id') {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}`;
}
