// Read-only catalog inspection. Never imports the application or runs migrations.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { Client } = require('pg');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync(new URL('../backend/.env', import.meta.url)));
const client = new Client({ connectionString: process.env.AUDIT_DATABASE_URL || env.DATABASE_URL,
  connectionTimeoutMillis: 10000 });
const result = { capturedAt: new Date().toISOString(), scope: 'Configured local database; production identity unconfirmed', queries: {} };
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout='5s'");
  await client.query("SET LOCAL lock_timeout='1s'");
  for (const [name, sql] of Object.entries({
    tables: `SELECT relname,n_live_tup,n_dead_tup,seq_scan,idx_scan,last_analyze,last_autoanalyze FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname`,
    indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    extensions: `SELECT extname FROM pg_extension`,
    settings: `SELECT name,setting FROM pg_settings WHERE name IN ('max_connections','shared_buffers','statement_timeout','transaction_read_only')`
  })) {
    const start=performance.now(); const response=await client.query(sql);
    result.queries[name]={clientRoundTripMs:performance.now()-start,rows:response.rows};
  }
  const actor=(await client.query('SELECT salesman_id FROM invoices GROUP BY salesman_id ORDER BY count(*) DESC LIMIT 1')).rows[0]?.salesman_id;
  const location=(await client.query('SELECT location_id FROM stock_ledger GROUP BY location_id ORDER BY count(*) DESC LIMIT 1')).rows[0]?.location_id;
  const ids=actor?(await client.query('SELECT id FROM invoices WHERE salesman_id=$1',[actor])).rows.map(r=>r.id):[];
  const days=actor?(await client.query('SELECT work_day_id FROM work_days WHERE salesman_id=$1',[actor])).rows.map(r=>r.work_day_id):[];
  result.representativePlans={};
  const samples={
    snapshotInvoices:['SELECT i.*, s.name as salesman_name, s.phone as salesman_phone FROM invoices i LEFT JOIN salesmen s ON i.salesman_id=s.id WHERE i.salesman_id=$1 ORDER BY i.created_at',[actor]],
    snapshotItems:['SELECT * FROM sale_items WHERE invoice_id=ANY($1::varchar[])',[ids]],
    snapshotLedger:['SELECT * FROM stock_ledger WHERE work_day_id=ANY($1::varchar[]) OR location_id=ANY($2::varchar[])',[days,[location]]],
    monthSales:["SELECT id,invoice_number,created_at,customer_name,total_amount_paise,payment_mode,status FROM invoices WHERE status='VALID' AND calendar_date >= date_trunc('month',$1::date) AND calendar_date <= $1 ORDER BY created_at DESC",['2026-10-13']],
    stockBalance:["SELECT product_id,COALESCE(SUM(CASE WHEN type IN ('LOAD_IN','UNLOAD_IN','SALE_CANCEL','ADJ_PLUS') THEN quantity_pieces WHEN type IN ('LOAD_OUT','UNLOAD_OUT','SALE','ADJ_MINUS') THEN -quantity_pieces ELSE 0 END),0) AS qty FROM stock_ledger WHERE location_id=$1 GROUP BY product_id",[location]],
    stockRequests:['SELECT sr.*, s.name AS salesman_name,v.name AS vehicle_name,g.name AS godown_name FROM stock_requests sr JOIN salesmen s ON s.id=sr.salesman_id JOIN vehicles v ON v.id=sr.vehicle_id JOIN godowns g ON g.id=sr.godown_id ORDER BY sr.requested_at DESC LIMIT 200',[]]
  };
  for(const [name,[sql,params]] of Object.entries(samples)) {
    const start=performance.now();
    const response=await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,params);
    const plan=response.rows[0]['QUERY PLAN'][0];
    // Plans may contain record identifiers in index conditions. Save only numeric summaries.
    result.representativePlans[name]={clientRoundTripMs:performance.now()-start,planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],actualRows:plan.Plan['Actual Rows'],sharedHitBlocks:plan.Plan['Shared Hit Blocks'],sharedReadBlocks:plan.Plan['Shared Read Blocks']};
  }
  fs.writeFileSync(new URL('./evidence/db-catalog.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify({success:true,tables:result.queries.tables.rows.length,extensions:result.queries.extensions.rows}));
} catch (error) { console.error(JSON.stringify({success:false,code:error.code,message:'Read-only database catalog inspection unavailable'})); process.exitCode=1; }
finally { await client.query('ROLLBACK').catch(()=>{}); await client.end(); }
