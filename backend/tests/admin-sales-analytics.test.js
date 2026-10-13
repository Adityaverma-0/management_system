import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { installOperations } from '../operations.js';
import { installSecurity } from '../security.js';
test('admin charts reuse filtered valid invoices and existing queries; salesmen are forbidden', async () => {
  let role = 'admin';
  const queries = [];
  const db = { query: async (sql, params) => {
    if (sql.includes('auth_sessions')) return { rows: [{ user_id: 'user', role }] };
    if (sql.includes('FROM salesmen')) return { rows: [{ id: 'user', active: true, status: 'ACTIVE' }] };
    queries.push({ sql, params });
    if (sql.includes('COUNT(DISTINCT')) return { rows: [{ total_sales: '30000', total_orders: '2', unique_customers: '1' }] };
    return { rows: [{ id: 'a', calendar_date: params[0], total_amount_paise: '10000', payment_mode: 'CASH' }, { id: 'b', calendar_date: params[0], total_amount_paise: '20000', payment_mode: 'UPI' }] };
  } };
  const app = express(); installSecurity(app, db); installOperations(app, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v2/admin/sales`;
    const headers = { Authorization: `Bearer ${'a'.repeat(64)}` };
    for (const filter of ['date=2026-10-14', 'period=week', 'period=month']) {
      queries.length = 0;
      const response = await fetch(`${base}?${filter}`, { headers });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.analytics.totalAmountPaise, data.stats.totalSales);
      assert.equal(data.analytics.totalBills, 2);
      assert.deepEqual(data.analytics.payments, { CASH: 10000, UPI: 20000, CREDIT: 0 });
      assert.equal(data.analytics.series.reduce((sum, row) => sum + row.amountPaise, 0), 30000);
      if (filter === 'period=week') assert.equal(data.analytics.series.length, 7);
      assert.equal(queries.length, 2);
      assert(queries.every(q => q.sql.includes("status='VALID'")));
      assert.deepEqual(queries[0].params, queries[1].params);
    }
    role = 'salesman'; queries.length = 0;
    assert.equal((await fetch(base, { headers })).status, 403);
    assert.equal(queries.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
