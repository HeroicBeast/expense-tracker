// Project-wide India localization: ₹ with Indian digit grouping, day-first
// DD MMM YYYY dates, and en-IN month labels — no US formats anywhere.
import { describe, it, expect } from 'vitest';
import { formatINR, formatSigned, parseAmount, round2 } from '../src/lib/money.js';
import {
  formatDateIndian,
  formatDateKey,
  formatDateTime,
  monthLabel,
} from '../src/lib/selectors.js';

describe('currency — ₹ with Indian numbering (lakh/crore grouping)', () => {
  it('uses Intl en-IN currency style for the Indian Rupee', () => {
    expect(formatINR(150000)).toBe('₹1,50,000');
    expect(formatINR(1234567)).toBe('₹12,34,567');
    expect(formatINR(12345678901)).toBe('₹12,34,56,78,901');
    expect(formatINR(0)).toBe('₹0');
  });

  it('keeps paisa only when present and never renders US grouping', () => {
    expect(formatINR(999.99)).toBe('₹999.99');
    expect(formatINR(9000)).toBe('₹9,000'); // never ₹9,000.00 or $9,000
    expect(formatINR(150000)).not.toContain('$');
    expect(formatINR(150000)).not.toBe('₹150,000'); // not western grouping
  });

  it('signs negatives with −₹ (never -$ or -₹ with ASCII hyphen)', () => {
    expect(formatINR(-250)).toBe('−₹250');
    expect(formatSigned(450)).toBe('+₹450');
    expect(formatSigned(-450)).toBe('−₹450');
    expect(formatSigned(0)).toBe('₹0');
  });

  it('parses user input that carries ₹ and Indian commas', () => {
    expect(parseAmount('₹1,50,000')).toBe(150000);
    expect(round2(parseAmount('1,234.56'))).toBe(1234.56);
  });
});

describe('dates — Indian day-first DD MMM YYYY', () => {
  const ts = new Date(2026, 10, 2, 16, 35).getTime(); // 2 November 2026, 4:35 pm

  it('formats timestamps day-first with the year', () => {
    expect(formatDateIndian(ts)).toBe('02 Nov 2026');
    expect(formatDateTime(ts)).toMatch(/^02 Nov 2026, \d{1,2}:\d{2}/);
    // Never US month-first numeric style:
    expect(formatDateIndian(ts)).not.toMatch(/^11\/02\/2026|^11-02-2026/);
  });

  it('formats YYYY-MM-DD keys as DD MMM YYYY (report periods)', () => {
    expect(formatDateKey('2026-11-02')).toBe('02 Nov 2026');
    expect(formatDateKey('2026-01-05')).toBe('05 Jan 2026');
    expect(formatDateKey('2026-12-31')).toBe('31 Dec 2026');
  });

  it('labels months with en-IN locale', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(monthLabel('2026-10', 'short')).toBe('Oct');
  });
});
