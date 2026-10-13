// Integer arithmetic preserves paise and rounds each configured tax half-up.
function safe(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid monetary amount.');
  return n;
}
export function taxPaise(subtotal, percent) {
  const rate = String(percent ?? 0);
  if (!/^\d+(\.\d{1,8})?$/.test(rate) || Number(rate) > 100) throw new RangeError('Invalid tax rate.');
  const [whole, fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(safe(subtotal)) * BigInt(whole + fraction);
  const denominator = 100n * scale;
  return safe((numerator + denominator / 2n) / denominator);
}
export function calculateBill(subtotal, cgst = 0, sgst = 0) {
  const cgstAmountPaise = taxPaise(subtotal, cgst);
  const sgstAmountPaise = taxPaise(subtotal, sgst);
  const unroundedTotalPaise = safe(BigInt(safe(subtotal)) + BigInt(cgstAmountPaise) + BigInt(sgstAmountPaise));
  const totalAmountPaise = safe(((BigInt(unroundedTotalPaise) + 50n) / 100n) * 100n);
  return { subtotalPaise: subtotal, cgstAmountPaise, sgstAmountPaise, unroundedTotalPaise, totalAmountPaise, roundOffPaise: totalAmountPaise - unroundedTotalPaise };
}
