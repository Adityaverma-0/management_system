import { describe, it, expect } from 'vitest';
import { Invoice } from './types';

describe('History Performance Targets', () => {
  it('filters 15,000 invoices in under 100ms', () => {
    // Generate 15,000 mock invoices
    const invoices: Invoice[] = [];
    const now = Date.now();
    for (let i = 0; i < 15000; i++) {
      invoices.push({
        id: `inv-${i}`,
        invoiceNumber: `INV-${i}`,
        createdAt: now - i * 1000,
        calendarDate: '2026-10-04',
        workDayId: 'wd-1',
        salesmanId: 'sm-1',
        outletId: 'out-1',
        customerId: i % 10 === 0 ? 'cust-1' : 'cust-2',
        items: [{ productId: 'p-1', quantityPieces: 1, lineTotalPaise: 1000 }],
        totalAmountPaise: 1000,
        paymentMode: i % 3 === 0 ? 'CASH' : 'UPI',
        status: i % 20 === 0 ? 'VOID' : 'VALID'
      });
    }

    const start = performance.now();
    
    // Simulate filtering by VALID + UPI + specific customer
    const filtered = invoices.filter(inv => 
      inv.status === 'VALID' && 
      inv.paymentMode === 'UPI' && 
      inv.customerId === 'cust-2'
    );
    
    // Simulate Grouping by Date
    const map = new Map<string, number>();
    for (const inv of filtered) {
      map.set(inv.calendarDate, (map.get(inv.calendarDate) || 0) + 1);
    }
    
    const end = performance.now();
    const duration = end - start;
    
    // Expect well under 100ms (typically takes <10ms in node)
    expect(duration).toBeLessThan(100);
    expect(filtered.length).toBeGreaterThan(0);
  });
});
