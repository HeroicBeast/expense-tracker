// Split computation for the three entry modes: Equal, Manual exact shares and
// Itemized + proportional tax/delivery/service charges.
//
// Invariant enforced everywhere: the final shares ALWAYS sum exactly to the
// bill amount (rounding remainders are given to "you"), so cash flow,
// personal spend and friend ledgers stay reconciled.

import { round2, parseAmount } from './money.js';

export const SPLIT_MODES = [
  { id: 'equal', label: 'Equal' },
  { id: 'manual', label: 'Manual Share' },
  { id: 'itemized', label: 'Itemized + Tax' },
];

/** Divide `amount` equally across `participants` (ids like 'you', 'f_1'). */
export function equalShares(amount, participants) {
  const total = round2(amount);
  const n = participants.length;
  if (n === 0) return [];
  const base = Math.floor((total / n) * 100) / 100; // floor to paisa
  const shares = participants.map((who) => ({ who, amount: round2(base) }));
  // Hand any rounding remainder to you so Σ shares === amount exactly.
  const sum = round2(shares.reduce((acc, s) => acc + s.amount, 0));
  shares[0].amount = round2(shares[0].amount + (round2(total - sum)));
  return shares;
}

/**
 * Build shares for the active mode.
 * @returns {{ shares: Array<{who:string,amount:number}>, amount: number, error: string|null }}
 *   `amount` is the bill total (auto-derived for itemized mode).
 */
export function computeShares({
  mode = 'equal',
  amount,
  participants,
  manual = {},
  bases = {},
  sharedCharges = '',
}) {
  if (!participants.length) {
    return { shares: [], amount: 0, error: 'Pick at least one friend to split with.' };
  }

  if (mode === 'equal') {
    const total = parseAmount(amount);
    if (!Number.isFinite(total) || total <= 0) {
      return { shares: [], amount: 0, error: 'Enter a valid bill amount first.' };
    }
    return { shares: equalShares(total, participants), amount: round2(total), error: null };
  }

  if (mode === 'manual') {
    const total = parseAmount(amount);
    if (!Number.isFinite(total) || total <= 0) {
      return { shares: [], amount: 0, error: 'Enter a valid bill amount first.' };
    }
    const shares = [];
    let sum = 0;
    for (const who of participants) {
      const v = parseAmount(manual[who]);
      if (!Number.isFinite(v) || v < 0) {
        return { shares: [], amount: 0, error: 'Every participant needs a valid share.' };
      }
      shares.push({ who, amount: round2(v) });
      sum = round2(sum + v);
    }
    const diff = round2(total - sum);
    if (Math.abs(diff) >= 0.01) {
      return {
        shares: [],
        amount: 0,
        error:
          diff > 0
            ? `Shares are ${`₹${diff}`} short of the bill total.`
            : `Shares are ${`₹${Math.abs(diff)}`} over the bill total.`,
      };
    }
    // Absorb any 1-paisa float drift into your share.
    shares[0].amount = round2(shares[0].amount + diff);
    return { shares, amount: round2(total), error: null };
  }

  // itemized: base per person + shared charges split proportionally to base.
  const charges = parseAmount(sharedCharges);
  if (!Number.isFinite(charges) || charges < 0) {
    return { shares: [], amount: 0, error: 'Shared tax/delivery must be a valid amount.' };
  }
  let totalBase = 0;
  const parsed = [];
  for (const who of participants) {
    const v = parseAmount(bases[who]);
    if (!Number.isFinite(v) || v < 0) {
      return { shares: [], amount: 0, error: 'Every participant needs a valid item amount.' };
    }
    parsed.push({ who, base: round2(v) });
    totalBase = round2(totalBase + v);
  }
  if (totalBase <= 0 && charges > 0) {
    return {
      shares: [],
      amount: 0,
      error: 'Enter item amounts so shared charges can be split proportionally.',
    };
  }
  if (totalBase <= 0 && charges <= 0) {
    return { shares: [], amount: 0, error: 'Enter at least one item amount.' };
  }

  const billTotal = round2(totalBase + charges);
  const shares = parsed.map(({ who, base }) => {
    const portion = totalBase > 0 ? charges * (base / totalBase) : 0;
    return { who, amount: round2(base + portion) };
  });
  // Fix rounding drift (charges distribution) so Σ shares === billTotal.
  const sum = round2(shares.reduce((acc, s) => acc + s.amount, 0));
  const drift = round2(billTotal - sum);
  if (drift !== 0) shares[0].amount = round2(shares[0].amount + drift);
  return { shares, amount: billTotal, error: null };
}
