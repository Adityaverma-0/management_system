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
.daily-report { font: 9pt/1.35 Arial, 'Noto Sans', sans-serif; color:#111827; }
.daily-report * { box-sizing:border-box; }
.daily-report header { border-bottom:2px solid #1e3a8a; padding-bottom:3mm; margin-bottom:4mm; }
.daily-report h1 { font-size:16pt; line-height:1.1; margin:0 0 2mm; font-weight:700; color:#1e3a8a; }
.daily-report .business { font-size:10pt; font-weight:700; color:#4b5563; text-transform:uppercase; letter-spacing:0.5px; }
.daily-report .metadata { display:grid; grid-template-columns:repeat(3,1fr); gap:1mm 4mm; font-size:8.5pt; color:#374151; }
.daily-report h2 { font-size:10pt; font-weight:700; margin:4mm 0 1.5mm; color:#1f2937; border-bottom:1px solid #e5e7eb; padding-bottom:1mm; text-transform:uppercase; letter-spacing:0.3px; break-after:avoid; }
.daily-report table { border-collapse:collapse; margin-bottom:3mm; font-size:8.5pt; width:100%; break-inside:avoid; }
.daily-report th { background:#f3f4f6; font-weight:700; text-align:left; border-bottom:1px solid #d1d5db; color:#374151; }
.daily-report th, .daily-report td { border-bottom:1px solid #e5e7eb; vertical-align:top; padding:1.5mm 2mm !important; }
.daily-report tbody tr:nth-child(even) { background:#f9fafb; }
.daily-report .numeric { text-align:right; font-variant-numeric:tabular-nums; }
.daily-report .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:2mm; margin-bottom:3mm; break-inside:avoid; }
.daily-report .metric { background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; padding:2mm 3mm; }
.daily-report .metric span { display:block; font-size:7.5pt; color:#64748b; font-weight:600; text-transform:uppercase; }
.daily-report .metric strong { display:block; font-size:11pt; margin-top:0.5mm; color:#0f172a; }
.daily-report .note, .daily-report footer { font-size:7.5pt; color:#64748b; }
.daily-report footer { border-top:1px solid #e5e7eb; margin-top:4mm; padding-top:1.5mm; text-align:center; break-inside:avoid; }
.daily-report tr { break-inside:avoid; }
`;

export function buildDailyReport(data: DailyReportData): HTMLElement {
  const products = rows(data.products);
  if (number(data.total) === undefined || !Number.isSafeInteger(data.total)) throw new Error('The daily sales total is unavailable. Refresh the report and try again.');
  const root = document.createElement('article'); root.className = 'daily-report'; root.dataset.dailyReport = 'true';
  const make = (tag: string, text?: string, className?: string) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  root.append(make('style', styles));

  // A. Business Header
  const header = make('header');
  if (reportText(data.businessName) !== dash) header.append(make('p', reportText(data.businessName), 'business'));
  header.append(make('h1', 'DAILY BUSINESS REPORT'));
  const generated = `${reportDate(data.generatedAt ?? Date.now(), true)} IST`;
  const metadata = make('div', undefined, 'metadata');
  for (const [key, value] of [
    ['Report Date', reportDate(data.date)],
    ['Salesman', reportText(data.salesman)],
    ['Vehicle', reportText(data.vehicle)],
    ['Status', label(data.status)],
    ['Generated', generated],
    ['Warehouse', reportText(data.warehouse)]
  ]) {
    if ((key === 'Warehouse' || key === 'Generated') && value === dash) continue;
    metadata.append(make('p', `${key}: ${value}`));
  }
  header.append(metadata);
  root.append(header);

  // B. Daily Summary (4 large summary figures)
  root.append(make('h2', 'Daily Summary'));
  const summary = make('div', undefined, 'summary');
  const totalSales = reportMoney(data.total);
  const cashCollected = reportMoney(data.collected ?? data.cash);
  const upiCollection = reportMoney(data.upi);
  const creditSales = reportMoney(data.credit);
  for (const [name, value] of [
    ['Total Sales', totalSales],
    ['Cash Collected', cashCollected],
    ['UPI Collection', upiCollection],
    ['Credit Sales', creditSales]
  ]) {
    const cell = make('div', undefined, 'metric');
    cell.append(make('span', name), make('strong', value));
    summary.append(cell);
  }
  root.append(summary);

  const table = (title: string, headers: string[], values: string[][], widths: number[], numeric: number[] = []) => {
    root.append(make('h2', title));
    if (!values.length) { root.append(make('p', 'No records for this day.', 'note')); return; }
    const t = make('table'), cols = make('colgroup');
    widths.forEach(width => { const c = make('col'); c.style.width = `${width}%`; cols.append(c); }); t.append(cols);
    const head = make('thead'), hr = make('tr'); headers.forEach((h, i) => { const th = make('th', h, numeric.includes(i) ? 'numeric' : ''); th.setAttribute('scope', 'col'); hr.append(th); }); head.append(hr); t.append(head);
    const body = make('tbody'); values.forEach(row => { const tr = make('tr'); row.forEach((cell, i) => tr.append(make('td', cell, numeric.includes(i) ? 'numeric' : ''))); body.append(tr); }); t.append(body); root.append(t);
  };

  const productName = (p: Row) => p.productName === p.productId ? dash : reportText(p.productName);

  // C. Products Sold (Compact table of products with actual sales)
  const soldProducts = products.filter(p => {
    const soldQty = number(p.soldPieces ?? p.sold) ?? 0;
    const soldAmt = number(p.soldAmountPaise ?? p.salesPaise) ?? 0;
    return soldQty !== 0 || soldAmt !== 0;
  });
  table(
    'Products Sold',
    ['No.', 'Product', 'Quantity Sold', 'Sales Amount'],
    soldProducts.map((p, i) => [String(i + 1), productName(p), quantity(p.soldPieces ?? p.sold), reportMoney(p.soldAmountPaise ?? p.salesPaise)]),
    [8, 52, 20, 20],
    [0, 2, 3]
  );

  // D. Operational Vehicle Stock (Meaningful movement or remaining quantity)
  const operationalProducts = products.filter(p => {
    const opening = number(p.opening ?? p.startFromHeldPieces) ?? 0;
    const loaded = number(p.loadedAtStart ?? p.startLoadedPieces) ?? 0;
    const topUp = number(p.topUp) ?? 0;
    const sold = number(p.soldPieces ?? p.sold) ?? 0;
    const remaining = number(p.expectedRemaining ?? p.countedRemaining) ?? 0;
    const diff = number(p.difference) ?? 0;
    const hold = number(p.holdQty ?? p.remainingHeldInVehiclePieces) ?? 0;
    const unload = number(p.unloadQty ?? p.remainingToGodownPieces) ?? 0;
    return opening > 0 || loaded > 0 || topUp > 0 || sold > 0 || remaining > 0 || diff !== 0 || hold > 0 || unload > 0;
  });

  if (operationalProducts.length > 0) {
    table(
      'Operational Vehicle Stock',
      ['Product', 'Loaded', 'Sold', 'Remaining'],
      operationalProducts.map(p => [
        productName(p),
        quantity((number(p.loadedAtStart ?? p.startLoadedPieces) ?? 0) + (number(p.topUp) ?? 0)),
        quantity(p.soldPieces ?? p.sold),
        quantity(p.countedRemaining ?? p.expectedRemaining)
      ]),
      [40, 20, 20, 20],
      [1, 2, 3]
    );
  } else {
    root.append(make('h2', 'Operational Vehicle Stock'));
    root.append(make('p', 'No operational stock movement recorded for this day.', 'note'));
  }

  // E. Cash Denomination & Payments Summary (Compact)
  const payments = [
    ['Cash Sales', reportMoney(data.cash)],
    ['UPI Sales', reportMoney(data.upi)],
    ['Credit Sales', reportMoney(data.credit)]
  ];
  if (data.collected !== undefined) payments.push(['Cash Collected', reportMoney(data.collected)]);
  table('Payments & Collections Summary', ['Category', 'Amount'], payments, [70, 30], [1]);

  if (data.cashBreakdown && typeof data.cashBreakdown === 'object' && !Array.isArray(data.cashBreakdown)) {
    const cash = data.cashBreakdown as Row;
    const denomValues: Record<string, number> = {
      NOTE_500: 50000, NOTE_200: 20000, NOTE_100: 10000, NOTE_50: 5000, NOTE_20: 2000, NOTE_10: 1000,
      COIN_10: 1000, COIN_5: 500, COIN_2: 200, COIN_1: 100, PAISE: 1
    };
    let calcTotal = 0;
    for (const [k, v] of Object.entries(denomValues)) {
      const count = number(cash[k]) ?? 0;
      calcTotal += count * v;
    }
    const collectedPaise = number(data.collected) ?? 0;
    const cashDiff = collectedPaise - calcTotal;

    const denominations = ['NOTE_500', 'NOTE_200', 'NOTE_100', 'NOTE_50', 'NOTE_20', 'NOTE_10', 'COIN_10', 'COIN_5', 'COIN_2', 'COIN_1'];
    const counted = denominations.filter(key => number(cash[key]) !== undefined && cash[key] !== 0).map(key => {
      const [kind, value] = key.split('_');
      return [`₹ ${value} ${kind === 'NOTE' ? 'notes' : 'coins'}`, reportText(cash[key])];
    });

    if (counted.length > 0 && (cashDiff !== 0 || counted.length <= 6)) {
      table('Cash Denomination Count', ['Denomination', 'Count'], counted, [70, 30], [1]);
      if (cashDiff !== 0) {
        root.append(make('p', `Cash Discrepancy Note: Recorded collection (${reportMoney(collectedPaise)}) differs from denomination count total (${reportMoney(calcTotal)}) by ${reportMoney(Math.abs(cashDiff))}.`, 'note'));
      }
    }
  }

  // F. Exceptions / Important Notes
  const exceptions: string[] = [];
  for (const p of products) {
    const diff = number(p.difference) ?? 0;
    if (diff !== 0) exceptions.push(`Stock mismatch for ${productName(p)}: difference of ${quantity(diff)}.`);
  }
  if (data.status === 'SENT_BACK') exceptions.push('Report returned for correction.');
  if (data.status === 'PENDING') exceptions.push('Report pending final approval.');

  root.append(make('h2', 'Exceptions & Notes'));
  if (exceptions.length > 0) {
    for (const ex of exceptions) root.append(make('p', `• ${ex}`, 'note'));
  } else {
    root.append(make('p', 'No discrepancies recorded.', 'note'));
  }

  root.append(make('footer', `Daily Business Report • Generated ${generated}`));
  return root;
}
