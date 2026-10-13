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

// Preserve decimal historical invoices; new payable amounts are whole rupees.
export function formatPayable(paise: number): string {
  return paise % 100 === 0 ? `₹ ${paise / 100}` : formatRupees(paise);
}
