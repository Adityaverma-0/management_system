import { describe, expect, it } from 'vitest';
import { buildDailyReport, reportDate, reportMoney, reportText } from '../src/features/printing/DailyReport';
import { buildDailyReport as salesmanReport } from '../salesman-dashboard/src/features/printing/DailyReport';

const product = { productId: 'internal-product', productName: 'Tea & coffee', opening: 10, loadedAtStart: 15, topUp: 2, totalAvailable: 27, sold: 5, expectedRemaining: 22, countedRemaining: 22, difference: 0, unloadQty: 12, holdQty: 10, soldAmountPaise: 12345 };
const data = { businessName: 'Test fixture business', date: '2026-10-16', generatedAt: 1792117800000, total: 12400, cash: 12400, upi: 0, credit: 0, products: [product] };
describe.each([['admin', buildDailyReport], ['salesman', salesmanReport]] as const)('%s daily report', (_, build) => {
  it('preserves authoritative rounded totals separately from product amounts', () => {
    const report = build(data);
    expect(report.querySelector('.total')?.textContent).toBe('Total daily sales₹ 124.00');
    expect(report.textContent).toContain('₹ 123.45');
    expect(report.textContent).not.toContain('internal-product');
    expect(report.querySelectorAll('thead')).toHaveLength(4);
  });
  it('handles empty reports and optional nested fields without exposing objects', () => {
    const report = build({ ...data, total: 0, products: [], salesman: { id: 'secret' }, vehicle: null });
    expect(report.textContent).toContain('No records for this day.');
    expect(report.textContent).not.toMatch(/secret|\[object Object\]|undefined|null/);
  });
  it('escapes special characters and preserves Unicode and long product names', () => {
    const name = '<script>alert(1)</script> தமிழ் चाय & ' + 'Long product '.repeat(30);
    const report = build({ ...data, products: [{ ...product, productName: name }] });
    expect(report.querySelector('script')).toBeNull();
    expect(report.textContent).toContain(name.trim());
  });
  it('retains all rows of a large report and marks void invoices', () => {
    const report = build({ ...data, products: Array.from({ length: 200 }, () => product), invoices: [{ invoiceNumber: '2', customerName: 'Shop', status: 'VOID', paymentMode: 'CASH', totalAmountPaise: 50000 }] });
    expect(report.querySelectorAll('tbody')[0].children).toHaveLength(200);
    expect(report.textContent).toContain('Cancelled');
    expect(report.querySelector('.total')?.textContent).toContain('₹ 124.00');
  });
  it('fails visibly for missing totals and malformed report collections', () => {
    expect(() => build({ ...data, total: undefined })).toThrow('total is unavailable');
    expect(() => build({ ...data, products: { error: 'bad' } })).toThrow('incomplete');
  });
});
it('formats dates and integer paise safely', () => {
  expect(reportMoney(123456789)).toBe('₹ 12,34,567.89');
  expect(reportMoney({ value: 2 })).toBe('—');
  expect(reportText(['private'])).toBe('—');
  expect(reportDate('not a date')).toBe('—');
  expect(reportDate(null)).toBe('—');
  expect(reportDate('2026-10-16')).toContain('16 Oct 2026');
});
