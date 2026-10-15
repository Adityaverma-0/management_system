/**
 * WHAT: Converts integer paise to a formatted Rupee string (e.g. ₹ 10.50).
 * WHY: We store money as integers (paise) to prevent floating-point rounding errors (e.g. 0.1 + 0.2 = 0.30000000000000004).
 * TIME COMPLEXITY: O(1)
 */
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹ ${rupees.toFixed(2)}`;
}

/**
 * WHAT: Parses a rupee string/number back to integer paise.
 * WHY: User input will be in Rupees, but we need paise for storage.
 * TIME COMPLEXITY: O(1)
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

// Preserve exact paise, while omitting redundant decimals for whole rupees.
export function formatPayable(paise: number): string {
  return paise % 100 === 0 ? `₹ ${paise / 100}` : formatRupees(paise);
}

// Round once after summing the item amounts, matching backend billing.
export function roundPayablePaise(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError('Invalid monetary amount.');
  const rounded = Number(((BigInt(paise) + 50n) / 100n) * 100n);
  if (!Number.isSafeInteger(rounded)) throw new RangeError('Invalid monetary amount.');
  return rounded;
}
