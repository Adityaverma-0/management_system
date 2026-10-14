import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { installSecurity } from './security.js';
import { installOperations } from './operations.js';

const backendDir = path.dirname(fileURLToPath(import.meta.url));


dotenv.config({ path: path.join(backendDir, '.env') });

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5174,http://localhost:5173').split(',').map(origin => origin.trim());
app.use(cors({ origin: (origin, done) => done(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: '50mb' }));

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

// Helper for quick audit logging
async function logAudit(client, action, entity, details) {
  await client.query(
    'INSERT INTO audit_log (id, timestamp, action, entity, details) VALUES ($1, $2, $3, $4, $5)',
    [crypto.randomUUID(), Date.now(), action, entity, details]
  );
}

// Schema initialization happens at startup, never during PDF extraction.
export async function initializeDatabase() {
  try {
    await pool.query('SELECT NOW()');
    await pool.query('ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)');
    await pool.query('ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE');
  } catch (e) {
    console.warn("Initial DB check warning:", e.message);
  }
  const migrations = [
    `CREATE TABLE IF NOT EXISTS inventory_imports (id VARCHAR(50) PRIMARY KEY, timestamp BIGINT NOT NULL, import_ref VARCHAR(255) UNIQUE NOT NULL, supplier_name VARCHAR(255), godown_id VARCHAR(50))`,
    "migrations/001_inventory_import.sql",
    "migrations/002_production_integrity.sql",
    "migrations/003_tax_settings.sql",
    "migrations/004_stock_requests.sql",
    "migrations/005_performance_indexes.sql",
    "migrations/006_bill_round_off.sql",
    "migrations/007_log_pagination_index.sql"
  ];
  for (const mig of migrations) {
    try {
      const sql = mig.endsWith(".sql") ? fs.readFileSync(path.join(backendDir, mig), "utf8") : mig;
      await pool.query(sql);
    } catch (e) {
      console.warn("Migration notice (non-fatal):", mig, e.message);
    }
  }
}

installSecurity(app, pool);
installOperations(app, pool);

class ImportError extends Error {
  constructor(message, status = 400, code = 'INVALID_IMPORT') {
    super(message); this.status = status; this.code = code;
  }
}

const normalized = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const identifier = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();

export function matchInvoiceItem(item, products) {
  const active = products.filter(p => p.active !== false);
  const result = (matches, reason, certain) => ({
    ...item, product_id: certain && matches.length === 1 ? matches[0].id : null,
    match_status: certain && matches.length === 1 ? 'MATCHED' : matches.length ? 'NEEDS_REVIEW' : 'NEW_PRODUCT',
    match_reason: reason, candidates: matches.slice(0, 5).map(p => ({ id: p.id, name: p.name }))
  });
  for (const [field, label] of [['sku', 'SKU'], ['barcode', 'Barcode']]) {
    if (!identifier(item[field])) continue;
    const matches = active.filter(p => identifier(p[field]) === identifier(item[field]));
    if (matches.length) return result(matches, label, true);
  }
  const name = normalized(item.description);
  if (!name) return result([], 'No product name', false);
  const exact = active.filter(p => normalized(p.name) === name);
  if (exact.length) return result(exact, 'Exact product name', true);
  const words = new Set(name.split(' '));
  const scores = active.map(p => {
    const other = new Set(normalized(p.name).split(' '));
    const intersection = [...words].filter(w => other.has(w)).length;
    const similarity = intersection / new Set([...words, ...other]).size;
    const support = (item.hsn && identifier(item.hsn) === identifier(p.hsn) ? 0.05 : 0)
      + (item.unit && identifier(item.unit) === identifier(p.uom) ? 0.02 : 0);
    return { p, similarity, score: similarity + support };
  }).filter(x => x.similarity >= 0.5).sort((a, b) => b.score - a.score);
  return result(scores.map(x => x.p), scores.length ? 'Similar name; confirm the product' : 'Select or create an existing product', false);
}

function textField(value, label, max, required = false) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string' || value.length > max) throw new ImportError(`${label} is invalid.`);
  value = value.trim();
  if (required && !value) throw new ImportError(`${label} is required.`);
  return value || null;
}

function numericField(value, label, { required = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw new ImportError(`${label} is required.`);
    return null;
  }
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value))) throw new ImportError(`${label} must be a non-negative number.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n > max) throw new ImportError(`${label} is invalid.`);
  return n;
}

function moneyField(value, label, required = false) {
  const n = numericField(value, label, { required, max: 90000000000000 });
  if (n === null) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new ImportError(`${label} must have at most two decimal places.`);
  return Math.round(n * 100);
}

export async function saveInventoryImport(body, database = pool, actorId = null) {
  if (!body || typeof body !== 'object') throw new ImportError('A JSON invoice is required.');
  const importRef = textField(body.import_ref, 'Invoice number', 255, true);
  const supplier = textField(body.supplier_name, 'Supplier', 255, true);
  const godownId = textField(body.godown_id, 'Receiving godown', 50, true);
  const invoiceTotal = moneyField(body.invoice_total, 'Invoice total');
  const gstin = textField(body.supplier_gstin, 'Supplier GSTIN', 15);
  if (gstin && !/^[0-9A-Z]{15}$/i.test(gstin)) throw new ImportError('Supplier GSTIN must contain 15 letters and digits.');
  const invoiceDate = textField(body.invoice_date, 'Invoice date', 10);
  if (invoiceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || Number.isNaN(Date.parse(invoiceDate)) || new Date(invoiceDate).toISOString().slice(0, 10) !== invoiceDate)) throw new ImportError('Invoice date is invalid.');
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 1000) throw new ImportError('Provide between 1 and 1000 reviewed items.');
  const ids = body.lines.map(line => textField(line?.product_id, 'Product', 50, true));
  let client;
  try {
    client = await database.connect();
    await client.query('BEGIN');
    const godown = await client.query('SELECT id FROM godowns WHERE id = $1 AND active = TRUE FOR SHARE', [godownId]);
    if (!godown.rows.length) throw new ImportError('Select an existing active godown.');
    const { rows: products } = await client.query('SELECT * FROM products WHERE id = ANY($1::varchar[]) ORDER BY id FOR SHARE', [[...new Set(ids)].sort()]);
    const productMap = new Map(products.map(p => [p.id, p]));
    const lines = body.lines.map((line, i) => {
      const product = productMap.get(ids[i]);
      if (!product || product.active !== true) throw new ImportError(`Item ${i + 1}: select an existing active product.`);
      const quantity = numericField(line.quantity, `Item ${i + 1} quantity`, { required: true, max: 2147483647 });
      if (quantity <= 0) throw new ImportError(`Item ${i + 1}: quantity must be positive.`);
      const unit = textField(line.unit, `Item ${i + 1} UOM`, 30, true).toUpperCase();
      const multiplier = unit === 'PIECE' ? 1 : unit === 'BOX' ? Number(product.pieces_per_box) : unit === 'STRIP' ? Number(product.units_per_strip) : null;
      if (!multiplier || !Number.isSafeInteger(multiplier) || multiplier <= 0) throw new ImportError(`Item ${i + 1}: confirm UOM as BOX, STRIP or PIECE with a valid product conversion.`);
      const pieces = quantity * multiplier;
      if (!Number.isSafeInteger(pieces) || pieces <= 0 || pieces > 2147483647) throw new ImportError(`Item ${i + 1}: quantity must convert to a positive whole number of pieces.`);
      const discount = numericField(line.discount, 'Discount');
      const discountType = textField(line.discount_type, 'Discount type', 10);
      if (discount !== null && !['PERCENT', 'AMOUNT'].includes(discountType)) throw new ImportError('Select whether the discount is a percentage or amount.');
      if (discountType === 'PERCENT' && discount > 100) throw new ImportError('Discount percentage cannot exceed 100.');
      return {
        product_id: product.id, product_name: product.name, quantity, unit, quantity_pieces: pieces,
        purchase_price_paise: moneyField(line.unit_price, `Item ${i + 1} purchase price`, true),
        line_total_paise: moneyField(line.line_total, 'Line total'),
        taxable_amount_paise: moneyField(line.taxable_amount, 'Taxable amount'),
        cgst_paise: moneyField(line.cgst, 'CGST'), sgst_paise: moneyField(line.sgst, 'SGST'), igst_paise: moneyField(line.igst, 'IGST'),
        printed_discount_paise: moneyField(line.discount_amount, 'Printed discount amount'),
        gst: numericField(line.gst, 'GST percentage', { max: 100 }),
        discount: discountType === 'PERCENT' ? discount : null,
        discount_paise: discountType === 'AMOUNT' ? moneyField(line.discount, 'Discount amount') : null,
        discount_type: discount === null ? null : discountType,
        sku: textField(line.sku, 'SKU', 100), barcode: textField(line.barcode, 'Barcode', 100), hsn: textField(line.hsn, 'HSN', 20),
        extracted_name: textField(line.description, 'Extracted product name', 500)
      };
    });
    const discrepancies = [];
    for (const [i, line] of lines.entries()) {
      const gross = Math.round(line.quantity * line.purchase_price_paise);
      if (!Number.isSafeInteger(gross)) throw new ImportError('Purchase amount is too large.');
      const discount = line.printed_discount_paise ?? line.discount_paise ?? (line.discount !== null ? Math.round(gross * line.discount / 100) : null);
      if (discount !== null && line.taxable_amount_paise !== null && Math.abs(gross - discount - line.taxable_amount_paise) > 1) discrepancies.push(`Item ${i + 1}: taxable amount differs from quantity × price minus discount.`);
      if (line.printed_discount_paise !== null && line.discount !== null && Math.abs(Math.round(gross * line.discount / 100) - line.printed_discount_paise) > 1) discrepancies.push(`Item ${i + 1}: discount rate and printed discount amount differ.`);
      const taxes = [line.cgst_paise, line.sgst_paise, line.igst_paise];
      if (line.taxable_amount_paise !== null && line.line_total_paise !== null && taxes.some(tax => tax !== null) && Math.abs(line.taxable_amount_paise + taxes.reduce((sum, tax) => sum + (tax ?? 0), 0) - line.line_total_paise) > 1) discrepancies.push(`Item ${i + 1}: tax and line total differ.`);
    }
    if (invoiceTotal !== null && lines.every(line => line.line_total_paise !== null)) {
      const sum = lines.reduce((total, line) => total + line.line_total_paise, 0);
      if (!Number.isSafeInteger(sum)) throw new ImportError('Invoice amount is too large.');
      if (Math.abs(sum - invoiceTotal) > 1) discrepancies.push('Invoice total differs from the sum of reviewed line totals (check tax, freight and rounding).');
    }
    if (discrepancies.length && body.review_acknowledged !== true) throw new ImportError(discrepancies.join(' ') + ' Review and acknowledge the discrepancy before saving.', 422, 'TOTAL_MISMATCH');
    const id = `imp_${crypto.randomUUID()}`;
    await client.query(`INSERT INTO inventory_imports
      (id, timestamp, import_ref, supplier_name, godown_id, invoice_date, supplier_gstin, reviewed_lines)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, Date.now(), importRef, supplier, godownId, invoiceDate, gstin?.toUpperCase() || null, JSON.stringify(lines)]);
    for (const line of lines) {
      await client.query(`INSERT INTO stock_ledger
        (id, timestamp, type, product_id, quantity_pieces, location_id, reference_id, reason, note)
        VALUES ($1,$2,'LOAD_IN',$3,$4,$5,$6,'INVENTORY_IMPORT',$7)`,
        [`led_${crypto.randomUUID()}`, Date.now(), line.product_id, line.quantity_pieces, godownId, id, `Import Ref: ${importRef}`]);
    }
    await logAudit(client, 'INVENTORY_IMPORT', id, { actor_id: actorId, import_ref: importRef, supplier_name: supplier, godown_id: godownId, invoice_date: invoiceDate, invoice_total_paise: invoiceTotal, discrepancies, review_acknowledged: body.review_acknowledged === true, lines });
    await client.query('COMMIT');
    return { success: true, id };
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && /inventory_imports.*(?:ref|key)/.test(error.constraint || '')) throw new ImportError('This invoice may already have been imported.', 409, 'DUPLICATE_INVOICE');
    throw error;
  } finally { client?.release(); }
}

app.post('/api/v2/admin/inventory/import', async (req, res) => {
  try { res.json(await saveInventoryImport(req.body, pool, req.user.id)); }
  catch (error) {
    res.status(error.status || 503).json({ success: false, code: error instanceof ImportError ? error.code : 'DATABASE_FAILED', error: error instanceof ImportError ? error.message : 'Inventory could not be saved. No partial import was committed. Please retry.' });
  }
});

export async function extractInvoicePdf(fileBase64) {
  if (typeof fileBase64 !== 'string' || fileBase64.length > 28 * 1024 * 1024) throw new ImportError('Select a PDF no larger than 20 MB.', 400, 'PDF_TOO_LARGE');
  const encoded = fileBase64.replace(/^data:application\/pdf;base64,/i, '');
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new ImportError('Invalid PDF upload.', 400, 'INVALID_PDF');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > 20 * 1024 * 1024 || !buffer.subarray(0, 1024).toString('latin1').trimStart().startsWith('%PDF-')) throw new ImportError('Please select a valid PDF file no larger than 20 MB.', 400, 'INVALID_PDF');
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'invoice-'));
  const tmpPath = path.join(tmpDir, 'invoice.pdf');
  try {
    await fs.promises.writeFile(tmpPath, buffer, { mode: 0o600 });
    const pyScript = path.join(backendDir, 'invoice_extraction', 'extractor.py');
    const pyBin = process.env.INVOICE_PYTHON || path.join(backendDir, 'invoice_extraction', 'venv', 'bin', 'python');
    return await new Promise((resolve, reject) => {
      const child = spawn(pyBin, ['-B', pyScript, tmpPath], { cwd: backendDir, detached: process.platform !== 'win32' });
      let stdout = '', settled = false;
      const terminate = () => {
        try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ }
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => { terminate(); finish(new ImportError('Local PDF extraction timed out. Try fewer pages or a clearer scan.', 504, 'PROCESSING_TIMEOUT')); }, 45000);
      child.on('error', () => finish(new ImportError('Local PDF extractor is unavailable. Check the Python environment.', 503, 'EXTRACTOR_UNAVAILABLE')));
      child.stdout.on('data', data => {
        stdout += data.toString();
        if (stdout.length > 5 * 1024 * 1024) { terminate(); finish(new ImportError('Extracted invoice exceeds the supported size.', 422, 'PDF_TOO_LARGE')); }
      });
      child.stderr.resume();
      child.on('close', code => {
        if (settled) return;
        try {
          if (code !== 0) throw new Error();
          const data = JSON.parse(stdout.trim());
          if (typeof data.success !== 'boolean') throw new Error();
          finish(null, data);
        } catch { finish(new ImportError('Local PDF extraction failed. Check the extraction dependencies.', 503, 'EXTRACTION_FAILED')); }
      });
    });
  } finally { await fs.promises.rm(tmpDir, { recursive: true, force: true }); }
}

let activeExtractions = 0;
app.post('/api/v2/admin/extract-invoice', async (req, res) => {
  const started = Date.now();
  let stage = 'extraction';
  try {
    if (activeExtractions >= 2) return res.status(429).json({ success: false, code: 'EXTRACTION_BUSY', error: 'Two invoices are being processed. Please retry shortly.' });
    activeExtractions++;
    let data;
    try { data = await extractInvoicePdf(req.body?.fileBase64); } finally { activeExtractions--; }
    if (!data.success) {
      console.warn('invoice_import', { stage, code: data.code, duration_ms: Date.now() - started });
      return res.status(/TIMEOUT/.test(data.code || '') ? 504 : 422).json(data);
    }
    stage = 'database';
    const matchStarted = Date.now();
    const { rows: products } = data.items.length ? await pool.query('SELECT id,name,sku,barcode,hsn,uom,active FROM products WHERE active = TRUE') : { rows: [] };
    const databaseMs = Date.now() - matchStarted;
    stage = 'matching';
    data.items = data.items.map(item => matchInvoiceItem(item, products));
    data.diagnostics = { ...data.diagnostics, database_ms: databaseMs, matching_ms: Date.now() - matchStarted - databaseMs, request_ms: Date.now() - started };
    console.info('invoice_import', { stage: 'complete', ...data.diagnostics });
    res.json(data);
  } catch (error) {
    const code = error instanceof ImportError ? error.code : stage === 'database' ? 'DATABASE_FAILED' : 'PRODUCT_MATCHING_FAILED';
    console.warn('invoice_import', { stage, code, duration_ms: Date.now() - started });
    res.status(error.status || 503).json({ success: false, code, error: error instanceof ImportError ? error.message : stage === 'database' ? 'Products could not be loaded. Check the database connection and retry.' : 'Product matching failed. Retry or contact the administrator.' });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((error, _req, res, next) => {
  if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed') {
    return res.status(error.status || 400).json({ success: false, error: error.type === 'entity.too.large' ? 'PDF upload is too large.' : 'Invalid JSON request.' });
  }
  next(error);
});

export { app, pool };
if (process.env.NODE_ENV !== 'test') {
  initializeDatabase().then(() => {
    const port = Number(process.env.PORT || 8000);
    const server = app.listen(port, () => console.log(`Backend API Server running on port ${port}`));
    const shutdown = () => server.close(() => pool.end());
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }).catch(error => { console.error('Database initialization failed:', error); process.exitCode = 1; });
}
