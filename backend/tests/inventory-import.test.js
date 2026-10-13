// @vitest-environment node
// Supports the existing frontend test discovery as well as node --test.
const runner = process.env.VITEST ? await import('vitest') : await import('node:test');
const test = process.env.VITEST
  ? (name, options, fn) => (options?.skip ? runner.test.skip : runner.test)(name, typeof options === 'function' ? options : fn, 120000)
  : runner.test;
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
process.env.NODE_ENV = 'test';
const { app, pool, matchInvoiceItem, saveInventoryImport, extractInvoicePdf } = await import('../index.js');
const product = { id: 'p1', name: 'Blue Pens', sku: 'PEN-1', barcode: '1234', hsn: '9608', active: true, pieces_per_box: 10, units_per_strip: 5 };
const invoice = (overrides = {}) => ({ import_ref: 'INV-2026-1', supplier_name: 'Test supplier', invoice_date: '2026-10-08', godown_id: 'g1', lines: [{ product_id: 'p1', quantity: '5', unit: 'BOX', unit_price: '12.50', gst: '18', hsn: '9608', sku: 'PEN-1' }], ...overrides });

test('matching priority, ambiguity, fuzzy review and inactive exclusion', () => {
  assert.equal(matchInvoiceItem({ sku: 'pen-1', description: 'Other name' }, [product]).product_id, 'p1');
  assert.equal(matchInvoiceItem({ barcode: '1234' }, [product]).product_id, 'p1');
  assert.equal(matchInvoiceItem({ description: '  BLUE   PENS ' }, [product]).match_status, 'MATCHED');
  assert.equal(matchInvoiceItem({ description: 'Blue Pens Box' }, [product]).match_status, 'NEEDS_REVIEW');
  assert.equal(matchInvoiceItem({ description: 'Blue Pens Box' }, [product]).product_id, null);
  assert.equal(matchInvoiceItem({ sku: 'PEN-1' }, [product, { ...product, id: 'p2' }]).match_status, 'NEEDS_REVIEW');
  assert.equal(matchInvoiceItem({ description: 'Blue Pens' }, [{ ...product, active: false }]).match_status, 'NEW_PRODUCT');
  assert.equal(matchInvoiceItem({ description: 'Unrelated', hsn: '9608' }, [product]).match_status, 'NEW_PRODUCT');
});

test('connection failure rejects cleanly and malformed requests never connect', async () => {
  await assert.rejects(saveInventoryImport(invoice(), { connect: async () => { throw new Error('database unavailable'); } }), /database unavailable/);
  let connected = false;
  const database = { connect: async () => { connected = true; throw new Error('Unexpected connection'); } };
  await assert.rejects(saveInventoryImport(undefined, database), /JSON/);
  await assert.rejects(saveInventoryImport(invoice({ import_ref: ' ' }), database), /Invoice number/);
  await assert.rejects(saveInventoryImport(invoice({ invoice_date: '2026-02-30' }), database), /date/);
  assert.equal(connected, false);
});

test('rollback and release on ledger failure; validation precedes writes', async () => {
  const queries = [];
  let released = false;
  const database = { connect: async () => ({
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('SELECT id FROM godowns')) return { rows: [{ id: 'g1' }] };
      if (sql.includes('SELECT * FROM products')) return { rows: [product] };
      if (sql.includes('INSERT INTO stock_ledger')) throw new Error('injected ledger failure');
      return { rows: [] };
    }, release: () => { released = true; }
  }) };
  await assert.rejects(saveInventoryImport(invoice(), database), /injected ledger failure/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert(!queries.includes('COMMIT'));
  assert(released);
  queries.length = 0;
  await assert.rejects(saveInventoryImport(invoice({ lines: [{ product_id: 'p1', quantity: '1.5', unit: 'PIECE', unit_price: '1' }] }), database), /whole number/);
  assert(!queries.some(sql => sql.includes('INSERT')));
});

test('real local PDF extraction; invalid upload and missing Python are handled', async () => {
  const original = process.env.INVOICE_PYTHON;
  const encoded = fs.readFileSync(new URL('../../ideal_invoice.pdf', import.meta.url)).toString('base64');
  const result = await extractInvoicePdf(encoded);
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0].unit_price, 300);
  await assert.rejects(extractInvoicePdf('not a pdf'), /Invalid PDF/);
  process.env.INVOICE_PYTHON = '/nonexistent/invoice-python';
  try { await assert.rejects(extractInvoicePdf(encoded), /unavailable/); }
  finally { if (original === undefined) delete process.env.INVOICE_PYTHON; else process.env.INVOICE_PYTHON = original; }
});

test('HTTP extraction only reads products and never writes stock', async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async sql => { queries.push(sql); return { rows: sql.includes('auth_sessions') ? [{ user_id: 'admin', role: 'admin' }] : [product] }; };
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}/api/v2/admin`;
  try {
    const result = await fetch(`${base}/extract-invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'a'.repeat(64)}` }, body: JSON.stringify({ fileBase64: fs.readFileSync(new URL('../../ideal_invoice.pdf', import.meta.url)).toString('base64') }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).items.length, 10);
    assert(queries.every(sql => sql.startsWith('SELECT')));
    const invalid = await fetch(`${base}/inventory/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'a'.repeat(64)}` }, body: '{broken' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).success, false);
    const missing = await fetch(`${base}/inventory/import`, { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(64)}` } });
    assert.equal(missing.status, 400);
  } finally { pool.query = originalQuery; await new Promise(resolve => server.close(resolve)); }
});

test('oversized extractor output terminates its OCR descendant as well as Python', { skip: process.platform === 'win32' }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-cancel-test-'));
  const script = path.join(folder, 'fake-python');
  const pidFile = path.join(folder, 'child-pid');
  const previous = process.env.INVOICE_PYTHON;
  let pid;
  fs.writeFileSync(script, `#!/usr/bin/env python3
import subprocess, sys, time
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
open(${JSON.stringify(pidFile)}, 'w').write(str(child.pid))
sys.stdout.write('x' * 6000000)
sys.stdout.flush()
time.sleep(60)
`, { mode: 0o700 });
  process.env.INVOICE_PYTHON = script;
  try {
    await assert.rejects(extractInvoicePdf(Buffer.from('%PDF-1.4\n').toString('base64')), error => error.code === 'PDF_TOO_LARGE');
    pid = Number(fs.readFileSync(pidFile, 'utf8'));
    let alive = true;
    for (let i = 0; i < 30 && alive; i++) {
      try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 50)); }
      catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    }
    assert.equal(alive, false, 'OCR child survived extractor cancellation');
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ } }
    if (previous === undefined) delete process.env.INVOICE_PYTHON; else process.env.INVOICE_PYTHON = previous;
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('PostgreSQL integration: atomic stock, duplicate race, rollback, metadata, receipt separation', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  // A unique disposable schema: never insert fixtures into public business tables.
  const schema = `invoice_test_${crypto.randomBytes(8).toString('hex')}`;
  const testUrl = new URL(process.env.TEST_DATABASE_URL);
  // Neon transaction poolers reject per-session startup options. Use the same database's direct endpoint for isolated test schemas.
  if (testUrl.hostname.endsWith('.neon.tech')) testUrl.hostname = testUrl.hostname.replace('-pooler.', '.');
  const testConnection = testUrl.toString();
  const admin = new pg.Pool({ connectionString: testConnection, connectionTimeoutMillis: 30000 });
  let database;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new pg.Pool({ connectionString: testConnection, connectionTimeoutMillis: 30000, options: `-c search_path=${schema}`, max: 4 });
    await database.query(fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    await database.query(fs.readFileSync(new URL('../migrations/001_inventory_import.sql', import.meta.url), 'utf8'));
    await database.query("INSERT INTO godowns(id,name,active) VALUES ('g1','Test warehouse',TRUE),('g2','Inactive',FALSE)");
    await database.query("INSERT INTO products(id,name,price_paise,pieces_per_box,units_per_strip,active) VALUES ('p1','Blue Pens',9900,10,5,TRUE),('p2','Inactive',100,1,1,FALSE)");
    await database.query("INSERT INTO stock_ledger(id,timestamp,type,product_id,quantity_pieces,location_id) VALUES ('opening',0,'LOAD_IN','p1',100,'g1')");
    const stock = async () => Number((await database.query("SELECT SUM(quantity_pieces) AS total FROM stock_ledger WHERE location_id='g1'")).rows[0].total);
    const result = await saveInventoryImport(invoice(), database);
    assert.equal(await stock(), 150);
    const saved = (await database.query('SELECT * FROM inventory_imports WHERE id=$1', [result.id])).rows[0];
    assert.equal(saved.reviewed_lines[0].purchase_price_paise, 1250);
    assert.equal(saved.reviewed_lines[0].quantity_pieces, 50);
    assert.equal(saved.reviewed_lines[0].gst, 18);
    assert.equal(saved.reviewed_lines[0].sku, 'PEN-1');
    assert.equal((await database.query('SELECT price_paise FROM products WHERE id=$1', ['p1'])).rows[0].price_paise, '9900');
    assert.equal((await database.query("SELECT COUNT(*) FROM purchases")).rows[0].count, '0');
    assert.equal((await database.query("SELECT COUNT(*) FROM purchase_lines")).rows[0].count, '0');
    await assert.rejects(saveInventoryImport(invoice({ import_ref: ' inv-2026-1 ' }), database), /already have been imported/);
    assert.equal(await stock(), 150);
    const race = await Promise.allSettled([saveInventoryImport(invoice({ import_ref: 'RACE-1' }), database), saveInventoryImport(invoice({ import_ref: 'race-1' }), database)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await stock(), 200);
    for (const body of [invoice({ godown_id: 'missing' }), invoice({ godown_id: 'g2' }), invoice({ lines: [{ ...invoice().lines[0], product_id: 'p2' }] }), invoice({ lines: [{ ...invoice().lines[0], quantity: '-1' }] }), invoice({ lines: [{ ...invoice().lines[0], unit_price: '' }] })]) {
      await assert.rejects(saveInventoryImport({ ...body, import_ref: crypto.randomUUID() }, database));
    }
    assert.equal(await stock(), 200);
    // Force a genuine database failure after import header and ledger writes.
    await database.query("ALTER TABLE audit_log ADD CONSTRAINT reject_test_audit CHECK (action <> 'INVENTORY_IMPORT') NOT VALID");
    await assert.rejects(saveInventoryImport(invoice({ import_ref: 'ROLLBACK-1' }), database));
    assert.equal(await stock(), 200);
    assert.equal((await database.query("SELECT COUNT(*) FROM inventory_imports WHERE import_ref='ROLLBACK-1'")).rows[0].count, '0');
  } finally {
    await database?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

test('tax metadata is preserved and mismatched invoice totals require review before writes', async () => {
  const queries = [];
  const database = { connect: async () => ({
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT id FROM godowns')) return { rows: [{ id: 'g1' }] };
      if (sql.includes('SELECT * FROM products')) return { rows: [product] };
      return { rows: [] };
    }, release: () => {}
  }) };
  const body = invoice({ invoice_total: '250', lines: [{ product_id: 'p1', quantity: '2', unit: 'PIECE', unit_price: '100', discount: '5', discount_type: 'PERCENT', discount_amount: '10', taxable_amount: '190', cgst: '9.50', sgst: '9.50', line_total: '209' }] });
  await assert.rejects(saveInventoryImport(body, database), error => error.code === 'TOTAL_MISMATCH');
  assert(!queries.some(q => q.sql.includes('INSERT')));
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  await saveInventoryImport({ ...body, review_acknowledged: true }, database);
  const saved = JSON.parse(queries.find(q => q.sql.includes('INSERT INTO inventory_imports')).params[7])[0];
  assert.equal(saved.taxable_amount_paise, 19000);
  assert.equal(saved.cgst_paise, 950);
  assert.equal(saved.sgst_paise, 950);
  assert.equal(saved.igst_paise, null);
  assert.equal(saved.printed_discount_paise, 1000);
  assert.equal(saved.discount, 5);
  assert.equal(saved.line_total_paise, 20900);
});
