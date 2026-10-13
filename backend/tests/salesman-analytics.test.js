// @vitest-environment node
import assert from 'node:assert/strict';
import express from 'express';
import { installOperations } from '../operations.js';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

test('analytics bounds dates, scopes the authenticated salesman and separates valid sales from void bills', async () => {
  const queries = [];
  let role = 'salesman';
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 's1', role }; next(); });
  installOperations(app, { query: async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [
      { calendar_date: '2026-09-30', status: 'VALID', payment_mode: 'CASH', bills: 2, amount: '10100' },
      { calendar_date: '2026-10-01', status: 'VALID', payment_mode: 'CREDIT', bills: 1, amount: '5000' },
      { calendar_date: '2026-10-01', status: 'VOID', payment_mode: 'UPI', bills: 3, amount: '99900' },
    ] };
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}/api/v2/salesman/analytics`;
  try {
    const load = async period => (await fetch(`${base}?from=2026-09-30&to=2026-10-02&period=${period}&salesmanId=s2`)).json();
    const daily = await load('day');
    assert.equal(daily.totalAmountPaise, 15100);
    assert.equal(daily.totalBills, 3);
    assert.deepEqual(daily.statuses, { VALID: 3, VOID: 3 });
    assert.deepEqual(daily.payments, { CASH: 10100, UPI: 0, CREDIT: 5000 });
    assert.deepEqual(daily.series.at(-1), { date: '2026-10-02', amountPaise: 0, bills: 0 });
    assert.deepEqual(queries[0].params, ['s1', '2026-09-30', '2026-10-02']);
    assert.match(queries[0].sql, /GROUP BY/);
    assert.deepEqual((await load('week')).series, [{ date: '2026-09-28', amountPaise: 15100, bills: 3 }]);
    assert.equal((await load('month')).series.length, 2);
    const count = queries.length;
    for (const args of ['from=2020-01-01&to=2026-01-01', 'from=2026-02-30', 'period=year', 'from=2026-10-03&to=2026-10-02']) {
      assert.equal((await fetch(`${base}?${args}`)).status, 400);
    }
    role = 'admin';
    assert.equal((await fetch(base)).status, 403);
    assert.equal(queries.length, count);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('analytics empty aggregates yield zero totals and zero-filled periods', async () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 's2', role: 'salesman' }; next(); });
  installOperations(app, { query: async () => ({ rows: [] }) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const data = await (await fetch(`http://127.0.0.1:${server.address().port}/api/v2/salesman/analytics?from=2026-01-01&to=2026-01-02`)).json();
    assert.equal(data.totalBills, 0);
    assert.equal(data.series.length, 2);
    assert(data.series.every(row => row.amountPaise === 0 && row.bills === 0));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
