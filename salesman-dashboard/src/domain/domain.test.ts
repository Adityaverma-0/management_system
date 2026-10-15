import { describe, it, expect } from 'vitest';
import { piecesToDisplay, displayToPieces } from './units';
import { canTransition } from './dayState';
import { calculateVehicleStockSummary, canFulfillStock, getLowStockSuggestions } from './stockLedger';
import { Product, StockLedgerEntry, Customer, AccountingLedgerEntry } from './types';
import { validateNewCustomer } from './customers';
import { validatePaymentMode } from './payments';
import { calculateAccountingTotals } from './accounting';

describe('Unit Conversions', () => {
  const p: Product = { id: 'p1', name: 'Test', pricePaise: 500, unitsPerStrip: 12, stripsPerBox: 12, piecesPerBox: 144 };
  it('converts correctly', () => {
    expect(piecesToDisplay(150, p)).toEqual({ boxes: 1, strips: 0, pieces: 6 });
    expect(displayToPieces({ boxes: 1, strips: 1, pieces: 1 }, p)).toBe(157);
  });
});

describe('Day State Machine', () => {
  it('allows valid transitions', () => {
    expect(canTransition('NOT_STARTED', 'LOADING')).toBe(true);
    expect(canTransition('ON_ROUTE', 'UNLOAD_REQUESTED')).toBe(true);
    expect(canTransition('UNLOAD_REQUESTED', 'APPROVED')).toBe(true);
  });
  it('blocks invalid transitions', () => {
    expect(canTransition('ON_ROUTE', 'CLOSED')).toBe(false);
  });
});

describe('Stock Ledger', () => {
  const entries: StockLedgerEntry[] = [
    { id: '1', timestamp: 1, type: 'LOAD_OUT', productId: 'p1', quantityPieces: -100, locationId: 'w1' },
    { id: '2', timestamp: 1, type: 'LOAD_IN', productId: 'p1', quantityPieces: 100, locationId: 'v1', workDayId: 'wd1' },
    { id: '3', timestamp: 2, type: 'SALE', productId: 'p1', quantityPieces: -20, locationId: 'v1', workDayId: 'wd1' },
  ];
  it('tracks vehicle stock', () => {
    const summary = calculateVehicleStockSummary(entries, 'v1', 'wd1', {});
    const stats = summary.get('p1');
    expect(stats?.loaded).toBe(100);
    expect(stats?.sold).toBe(20);
    expect(stats?.remaining).toBe(80);
  });
  it('prevents negative stock', () => {
    expect(canFulfillStock(entries, 'p1', 'v1', 100)).toBe(false);
    expect(canFulfillStock(entries, 'p1', 'v1', 80)).toBe(true);
  });
  it('tracks vehicle stock with HOLD_CARRY_FORWARD', () => {
    const holdEntries: StockLedgerEntry[] = [
      ...entries,
      { id: '4', timestamp: 3, type: 'HOLD_CARRY_FORWARD', productId: 'p1', quantityPieces: 80, locationId: 'v1', workDayId: 'wd1' }
    ];
    const summary = calculateVehicleStockSummary(holdEntries, 'v1', 'wd1', {});
    const stats = summary.get('p1');
    expect(stats?.loaded).toBe(100);
    expect(stats?.sold).toBe(20);
    expect(stats?.remaining).toBe(80);
  });
});

import { calculateBreakdownTotal, validateBreakdownCount, compareWithExpectedCash } from './cashDenominations';

describe('Cash Denominations', () => {
  it('calculates 1 x Rs 500 correctly and matches expected', () => {
    const breakdown = { 'NOTE_500': 1 };
    const { totalPaise, noteCount, coinCount } = calculateBreakdownTotal(breakdown);
    expect(totalPaise).toBe(50000);
    expect(noteCount).toBe(1);
    expect(coinCount).toBe(0);

    const { differencePaise, status } = compareWithExpectedCash(totalPaise, 50000);
    expect(differencePaise).toBe(0);
    expect(status).toBe('MATCH');
  });

  it('calculates complex mixed breakdown correctly', () => {
    // 2x200 + 3x100 + 1x50 + 4x10 coin + 1x5 + 2x2 + 1x1
    // = 400 + 300 + 50 + 40 + 5 + 4 + 1 = 800
    const breakdown = {
      'NOTE_200': 2,
      'NOTE_100': 3,
      'NOTE_50': 1,
      'COIN_10': 4,
      'COIN_5': 1,
      'COIN_2': 2,
      'COIN_1': 1
    };
    const { totalPaise, noteCount, coinCount } = calculateBreakdownTotal(breakdown);
    expect(totalPaise).toBe(80000);
    expect(noteCount).toBe(6);
    expect(coinCount).toBe(8);
  });

  it('separates Rs 10 note and Rs 10 coin', () => {
    const breakdown = { 'NOTE_10': 1, 'COIN_10': 1 };
    const { totalPaise, noteCount, coinCount } = calculateBreakdownTotal(breakdown);
    expect(totalPaise).toBe(2000);
    expect(noteCount).toBe(1);
    expect(coinCount).toBe(1);
  });

  it('validates counts correctly', () => {
    expect(validateBreakdownCount(5)).toBe(true);
    expect(validateBreakdownCount(0)).toBe(true);
    expect(validateBreakdownCount(9999)).toBe(true);
    expect(validateBreakdownCount(-1)).toBe(false); // negative
    expect(validateBreakdownCount(1.5)).toBe(false); // decimal
    expect(validateBreakdownCount(10000)).toBe(false); // over 9999
  });
});

describe('Top-up Suggestions', () => {
  it('calculates median correctly and suggests top-ups', () => {
    const stockSummary = new Map([
      ['p1', { remaining: 10, loaded: 0, sold: 0 }] // 10 is < 25% of median 100
    ]);
    const history = { 'p1': [100, 105, 95, 100, 110] }; // median 100
    const products = [{ id: 'p1', piecesPerBox: 10 }] as any[];
    const warehouseFn = () => 500; // lots of stock

    const sugg = getLowStockSuggestions(stockSummary, history, products, warehouseFn);
    expect(sugg).toHaveLength(1);
    expect(sugg[0].usualLevel).toBe(100);
    expect(sugg[0].suggestedTopUp).toBe(90); // 100 - 10
  });

  it('bounds suggestion by warehouse stock', () => {
    const stockSummary = new Map([['p1', { remaining: 10, loaded: 0, sold: 0 }]]);
    const history = { 'p1': [100, 100, 100] }; 
    const products = [{ id: 'p1', piecesPerBox: 10 }] as any[];
    const warehouseFn = () => 40; // warehouse only has 40

    const sugg = getLowStockSuggestions(stockSummary, history, products, warehouseFn);
    expect(sugg[0].suggestedTopUp).toBe(40);
  });
});

describe('Customers & Payments', () => {
  it('validates new customer mobile format', () => {
    expect(validateNewCustomer({ name: 'A', mobile: '123' })).toBe('Mobile must be 10 digits');
    expect(validateNewCustomer({ name: 'A', mobile: '9876543210' })).toBeNull();
  });

  it('blocks credit for walk-in', () => {
    expect(validatePaymentMode('CREDIT', 1000, undefined)).toBe('Credit is not allowed for walk-in customers.');
  });

  it('blocks credit if limit exceeded', () => {
    const c: Customer = { id: 'c1', name: 'A', mobile: '1', outstandingBalancePaise: 9000, creditLimitPaise: 10000 };
    expect(validatePaymentMode('CREDIT', 2000, c)).toContain('Credit limit exceeded');
    expect(validatePaymentMode('CREDIT', 1000, c)).toBeNull(); // Exactly at limit is fine
  });
});

describe('Accounting Totals', () => {
  it('calculates totals correctly with reversals', () => {
    const entries: AccountingLedgerEntry[] = [
      { id: '1', timestamp: 1, type: 'SALES_CASH', amountPaise: 1000, invoiceId: 'i1', workDayId: 'wd1' },
      { id: '2', timestamp: 1, type: 'SALES_UPI', amountPaise: 2000, invoiceId: 'i2', workDayId: 'wd1' },
      { id: '3', timestamp: 1, type: 'SALES_CREDIT', amountPaise: 3000, invoiceId: 'i3', workDayId: 'wd1' },
      { id: '4', timestamp: 1, type: 'REVERSAL_CASH', amountPaise: 500, invoiceId: 'i1', workDayId: 'wd1' }, // Void half (not realistic but tests math)
    ];
    const totals = calculateAccountingTotals(entries);
    expect(totals.cash).toBe(500);
    expect(totals.upi).toBe(2000);
    expect(totals.credit).toBe(3000);
    expect(totals.total).toBe(5500);
  });
});

describe('5000 Customer Search Speed', () => {
  it('searches prefix in <50ms', () => {
    const customers: Customer[] = [];
    for (let i = 0; i < 5000; i++) {
      customers.push({ id: `c${i}`, name: `Customer ${i}`, mobile: `90000${i.toString().padStart(5, '0')}`, outstandingBalancePaise: 0 });
    }
    // Pre-sort
    customers.sort((a, b) => a.name.localeCompare(b.name));
    
    const start = performance.now();
    const query = 'customer 499';
    let left = 0, right = customers.length - 1, startIdx = -1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const name = customers[mid].name.toLowerCase();
      if (name.startsWith(query)) {
        startIdx = mid;
        right = mid - 1; 
      } else if (name < query) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    const matches = [];
    if (startIdx !== -1) {
      for (let i = startIdx; i < customers.length; i++) {
        if (customers[i].name.toLowerCase().startsWith(query)) {
          matches.push(customers[i]);
        } else break;
      }
    }
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(50);
    expect(matches.length).toBeGreaterThan(0);
  });
});
