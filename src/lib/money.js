// Money helpers — all arithmetic is rounded to 2 decimal places (paisa) so
// balances, splits and budgets always reconcile exactly.

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Parse a user-entered amount ("1,234.5", "₹900") into a number, or NaN. */
export function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const cleaned = String(raw ?? '').replace(/[₹,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** ₹1,23,456 — keeps a leading − for negative values (no decimals unless present). */
export function formatINR(n) {
  const v = round2(n);
  const body = `₹${inrFormatter.format(Math.abs(v))}`;
  return v < 0 ? `−${body}` : body;
}

/** Signed variant: "+₹300" / "−₹200" / "₹0". */
export function formatSigned(n) {
  const v = round2(n);
  if (v > 0) return `+${formatINR(v)}`;
  if (v < 0) return `−${formatINR(Math.abs(v))}`;
  return formatINR(0);
}
