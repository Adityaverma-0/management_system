// Prices already include GST. Round the final payable to the nearest rupee (50 paise rounds up).
export const FALLBACK_BUSINESS_NAME = 'FMCG Van Sales';
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function calculateBill(total) {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('Invalid monetary amount.');
  const rounded = Number(((BigInt(total) + 50n) / 100n) * 100n);
  if (!Number.isSafeInteger(rounded)) throw new RangeError('Invalid monetary amount.');
  return { totalAmountPaise: rounded };
}

export function invoiceDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(timestamp));
}

export async function nextInvoiceSequence(client, salesmanId, date) {
  const { rows } = await client.query(`INSERT INTO invoice_counters(salesman_id,invoice_date,last_seq)
    VALUES($1,$2,1) ON CONFLICT(salesman_id,invoice_date)
    DO UPDATE SET last_seq=invoice_counters.last_seq+1 RETURNING last_seq`, [salesmanId,date]);
  return Number(rows[0].last_seq);
}
