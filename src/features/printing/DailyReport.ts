// Report presentation only: amounts and stock values are supplied by existing workflows.
type Row = Record<string, unknown>;
export type DailyReportData = {
  businessName?: unknown; date?: unknown; generatedAt?: number; submittedAt?: unknown;
  salesman?: unknown; vehicle?: unknown; warehouse?: unknown; status?: unknown;
  total?: unknown; cash?: unknown; upi?: unknown; credit?: unknown; collected?: unknown;
  transactions?: unknown; itemsSold?: unknown;
  products: unknown; invoices?: unknown; cashBreakdown?: unknown; paymentCounts?: unknown;
};
const dash = '—';
export function reportText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : dash;
}
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
export function reportMoney(value: unknown): string {
  const paise = number(value);
  if (paise === undefined || !Number.isSafeInteger(paise)) return dash;
  // Format integer paise without recalculating or rounding the authoritative total.
  const absolute = Math.abs(paise);
  return `${paise < 0 ? '-' : ''}₹ ${Math.floor(absolute / 100).toLocaleString('en-IN')}.${String(absolute % 100).padStart(2, '0')}`;
}
function quantity(value: unknown): string { const n = number(value); return n === undefined ? dash : `${n.toLocaleString('en-IN')} pcs`; }
export function reportDate(value: unknown, time = false): string {
  if (typeof value !== 'string' && typeof value !== 'number') return dash;
  const date = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : value);
  if (!Number.isFinite(date.getTime())) return dash;
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: true } as const : {}) });
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Report data is incomplete. Refresh the report and try again.');
  return value as Row[];
}
function label(value: unknown) {
  const labels: Record<string, string> = { UNLOAD_REQUESTED: 'Awaiting approval', ON_ROUTE: 'On route', SENT_BACK: 'Returned for correction', CLOSED: 'Closed', APPROVED: 'Approved', PENDING: 'Pending review', VALID: 'Valid', VOID: 'Cancelled', CASH: 'Cash', UPI: 'UPI', CREDIT: 'Credit' };
  return typeof value === 'string' ? labels[value] || reportText(value) : dash;
}
const styles = `
.daily-report { font: 10pt/1.45 Arial, 'Noto Sans', sans-serif; color:#172033; }
.daily-report * { box-sizing:border-box; }
.daily-report header { border-bottom:2px solid #245bd6; padding-bottom:4mm; margin-bottom:5mm; }
.daily-report h1 { font-size:19pt; line-height:1.2; margin:1mm 0 3mm; font-weight:700; }
.daily-report .business { font-size:11pt; font-weight:700; color:#245bd6; }
.daily-report .metadata { display:grid; grid-template-columns:1fr 1fr; gap:1mm 6mm; font-size:9pt; }
.daily-report h2 { font-size:12pt; font-weight:700; margin:6mm 0 2mm; break-after:avoid; }
.daily-report table { border-collapse:collapse; margin-bottom:3mm; font-size:9pt; }
.daily-report th { background:#edf1f7; font-weight:700; text-align:left; border-bottom:1px solid #aebaca; }
.daily-report th, .daily-report td { border-bottom:1px solid #dce3ee; vertical-align:top; padding:2mm !important; }
.daily-report tbody tr:nth-child(even) { background:#f7f8fa; }
.daily-report .numeric { text-align:right; font-variant-numeric:tabular-nums; }
.daily-report .summary { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid #dce3ee; break-inside:avoid; }
.daily-report .metric { padding:3mm; }
.daily-report .metric span { display:block; font-size:9pt; color:#536176; }
.daily-report .metric strong { display:block; font-size:13pt; margin-top:1mm; }
.daily-report .note, .daily-report footer { font-size:8pt; color:#536176; }
.daily-report .total { border-top:2px solid #245bd6; padding:3mm 0; display:flex; justify-content:space-between; font-size:12pt; font-weight:700; break-inside:avoid; }
.daily-report footer { border-top:1px solid #dce3ee; margin-top:5mm; padding-top:2mm; break-inside:avoid; }
.daily-report thead { display:table-header-group; }
.daily-report tr { break-inside:avoid; }
.daily-report p { margin:1mm 0; }
`;

export function buildDailyReport(data: DailyReportData): HTMLElement {
  const products = rows(data.products);
  const invoices = data.invoices === undefined ? undefined : rows(data.invoices);
  if (number(data.total) === undefined || !Number.isSafeInteger(data.total)) throw new Error('The daily sales total is unavailable. Refresh the report and try again.');
  const root = document.createElement('article'); root.className = 'daily-report'; root.dataset.dailyReport = 'true';
  const make = (tag: string, text?: string, className?: string) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const style = make('style', styles); root.append(style);
  const header = make('header');
  if (reportText(data.businessName) !== dash) header.append(make('p', reportText(data.businessName), 'business'));
  header.append(make('h1', 'DAILY BUSINESS REPORT'));
  const generated = `${reportDate(data.generatedAt ?? Date.now(), true)} IST`;
  const metadata = make('div', undefined, 'metadata');
  for (const [key, value] of [['Report date', reportDate(data.date)], ['Generated', generated], ['Salesman', reportText(data.salesman)], ['Vehicle', reportText(data.vehicle)], ['Warehouse', reportText(data.warehouse)], ['Status', label(data.status)]]) {
    if ((key === 'Vehicle' || key === 'Warehouse') && value === dash) continue;
    metadata.append(make('p', `${key}: ${value}`));
  }
  if (data.submittedAt !== undefined) metadata.append(make('p', `Submitted: ${reportDate(data.submittedAt, true)}`));
  header.append(metadata); root.append(header, make('h2', 'Daily sales summary'));
  const summary = make('div', undefined, 'summary');
  const metrics = [['Total sales', reportMoney(data.total)]];
  if (number(data.transactions) !== undefined) metrics.push(['Valid transactions', reportText(data.transactions)]);
  if (number(data.itemsSold) !== undefined) metrics.push(['Quantity sold', quantity(data.itemsSold)]);
  for (const [name, value] of metrics) { const cell = make('div', undefined, 'metric'); cell.append(make('span', name), make('strong', value)); summary.append(cell); }
  root.append(summary);
  const table = (title: string, headers: string[], values: string[][], widths: number[], numeric: number[] = []) => {
    root.append(make('h2', title));
    if (!values.length) { root.append(make('p', 'No records for this day.', 'note')); return; }
    const t = make('table'), cols = make('colgroup');
    widths.forEach(width => { const c = make('col'); c.style.width = `${width}%`; cols.append(c); }); t.append(cols);
    const head = make('thead'), hr = make('tr'); headers.forEach((h, i) => { const th = make('th', h, numeric.includes(i) ? 'numeric' : ''); th.setAttribute('scope', 'col'); hr.append(th); }); head.append(hr); t.append(head);
    const body = make('tbody'); values.forEach(row => { const tr = make('tr'); row.forEach((cell, i) => tr.append(make('td', cell, numeric.includes(i) ? 'numeric' : ''))); body.append(tr); }); t.append(body); root.append(t);
  };
  // Product IDs are never used as display-name fallbacks.
  const productName = (p: Row) => p.productName === p.productId ? dash : reportText(p.productName);
  const soldProducts = products.filter(p => (number(p.soldPieces ?? p.sold) ?? 0) !== 0 || (number(p.soldAmountPaise ?? p.salesPaise) ?? 0) !== 0);
  table('Product sales', ['No.', 'Product', 'Quantity sold', 'Sales amount'], soldProducts.map((p, i) => [String(i + 1), productName(p), quantity(p.soldPieces ?? p.sold), reportMoney(p.soldAmountPaise ?? p.salesPaise)]), [7, 49, 22, 22], [0, 2, 3]);
  table('Inventory movement', ['Product', 'Opening', 'Loaded', 'Top-up', 'Available', 'Sold'], products.map(p => [productName(p), quantity(p.opening), quantity(p.loadedAtStart), quantity(p.topUp), quantity(p.totalAvailable), quantity(p.sold)]), [35, 13, 13, 13, 13, 13], [1, 2, 3, 4, 5]);
  table('Remaining stock & reconciliation', ['Product', 'Expected', 'Counted', 'Difference', 'Unloaded', 'Held'], products.map(p => [productName(p), quantity(p.expectedRemaining), quantity(p.countedRemaining), quantity(p.difference), quantity(p.unloadQty), quantity(p.holdQty)]), [35, 13, 13, 13, 13, 13], [1, 2, 3, 4, 5]);
  root.append(make('p', 'Stock quantities are shown in pieces. Unloaded and held quantities reflect the recorded day status.', 'note'));
  const payments = [['Cash sales', reportMoney(data.cash)], ['UPI sales', reportMoney(data.upi)], ['Credit sales', reportMoney(data.credit)]];
  if (data.collected !== undefined) payments.push(['Cash collected', reportMoney(data.collected)]);
  if (data.paymentCounts && typeof data.paymentCounts === 'object' && !Array.isArray(data.paymentCounts)) {
    const counts = data.paymentCounts as Row;
    table('Payments & collections', ['Category', 'Transactions', 'Amount'], payments.map(([name, amount], i) => [name, i < 3 ? reportText(counts[['Cash', 'UPI', 'Credit'][i]]) : dash, amount]), [50, 20, 30], [1, 2]);
  } else table('Payments & collections', ['Category', 'Amount'], payments, [70, 30], [1]);
  if (data.cashBreakdown && typeof data.cashBreakdown === 'object' && !Array.isArray(data.cashBreakdown)) {
    const cash = data.cashBreakdown as Row;
    const denominations = ['NOTE_500', 'NOTE_200', 'NOTE_100', 'NOTE_50', 'NOTE_20', 'NOTE_10', 'COIN_10', 'COIN_5', 'COIN_2', 'COIN_1'];
    const counted = denominations.filter(key => number(cash[key]) !== undefined && cash[key] !== 0).map(key => {
      const [kind, value] = key.split('_');
      return [`₹ ${value} ${kind === 'NOTE' ? 'notes' : 'coins'}`, reportText(cash[key])];
    });
    table('Cash denomination count', ['Denomination', 'Count'], counted, [70, 30], [1]);
    if (number(cash.PAISE) !== undefined && cash.PAISE !== 0) root.append(make('p', `Additional cash: ${reportMoney(cash.PAISE)}`, 'note'));
  }
  if (invoices) {
    table('Invoice register', ['Invoice', 'Customer', 'Payment', 'Status', 'Amount'], invoices.map(i => [typeof i.invoiceNumber === 'number' || (typeof i.invoiceNumber === 'string' && /^\d+$/.test(i.invoiceNumber)) ? reportText(i.invoiceNumber) : dash, reportText(i.customerName), label(i.paymentMode), label(i.status), reportMoney(i.totalAmountPaise)]), [11, 38, 15, 15, 21], [4]);
    root.append(make('p', 'Cancelled invoices are listed for reference; daily sales totals exclude them.', 'note'));
  }
  const total = make('div', undefined, 'total'); total.append(make('span', 'Total daily sales'), make('span', reportMoney(data.total))); root.append(total);
  root.append(make('p', 'Product amounts and invoice totals use their recorded values. Invoice rounding may cause a difference between them.', 'note'));
  root.append(make('footer', `Daily business report • Generated ${generated}`));
  return root;
}
