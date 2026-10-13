// Local synthetic benchmark. Explicit loopback URL prevents production traffic.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import express from 'express';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { installOperations } from '../operations.js';
const url=process.env.TEST_DATABASE_URL;
if (!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Explicit loopback TEST_DATABASE_URL required');
const dir=await fs.mkdtemp('/tmp/dashboard-baseline-');
await fs.writeFile(dir+'/security.mjs',execFileSync('git',['show','HEAD:backend/security.js']));
await fs.writeFile(dir+'/operations.mjs',execFileSync('git',['show','HEAD:backend/operations.js']).toString().replace("'./security.js'","'./security.mjs'"));
const baseline=(await import(pathToFileURL(dir+'/operations.mjs'))).installOperations;
const admin=new pg.Pool({connectionString:url});
const results={environment:'Local PostgreSQL; 20 products, 20,000 stock movements, 30 sequential 20-item cash bills after 3 warmups; no WAN latency/auth overhead. Not production load.',runs:{}};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
for(const [name,install] of [['before',baseline],['after',installOperations]]) {
 const schema='bench_'+crypto.randomBytes(6).toString('hex');let db,server;
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  db=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
  await db.query(await fs.readFile(new URL('../../schema.sql',import.meta.url),'utf8'));
  for(const file of (await fs.readdir(new URL('../migrations/',import.meta.url))).sort()) {
   if(name==='before' && file.startsWith('007'))continue;
   await db.query(await fs.readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  await db.query("INSERT INTO godowns(id,name) VALUES('g','Warehouse'); INSERT INTO vehicles(id,name,godown_id) VALUES('v','Van','g'); INSERT INTO salesmen(id,name,phone,vehicle_id) VALUES('s','Seller','9888888888','v'); INSERT INTO work_days(work_day_id,calendar_date,salesman_id,vehicle_id,godown_id,state,opened_at) VALUES('d',CURRENT_DATE,'s','v','g','ON_ROUTE',1)");
  await db.query("INSERT INTO products(id,name,price_paise,units_per_strip,strips_per_box,pieces_per_box) SELECT 'p'||n,'Product '||n,100,1,1,1 FROM generate_series(1,20)n");
  await db.query("INSERT INTO stock_ledger(id,timestamp,type,product_id,quantity_pieces,location_id,work_day_id) SELECT 'l'||n,n,'LOAD_IN','p'||(1+(n%20)),100,'v','d' FROM generate_series(1,20000)n");
  await db.query('ANALYZE stock_ledger');
  let queries=0;const wrapped={query:async(...args)=>{queries++;return db.query(...args);},connect:async()=>{const c=await db.connect();return {query:async(...args)=>{queries++;return c.query(...args);},release:()=>c.release()};}};
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'s',role:'salesman'};next();});install(app,wrapped);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const body={workDayId:'d',paymentMode:'CASH',totalAmountPaise:2000,items:Array.from({length:20},(_,i)=>({productId:'p'+(i+1),quantityPieces:1}))};
  const measure=async(path,payload)=>{
   queries=0;const start=performance.now();
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2${path}`,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:payload?JSON.stringify(payload):undefined});
   const text=await response.text();if(!response.ok)throw new Error(text);
   return {ms:performance.now()-start,queries,bytes:Buffer.byteLength(text)};
  };
  for(let n=0;n<3;n++)await measure('/salesman/sales',body);
  const metrics={};
  for(const [label,path,payload] of [['bill','/salesman/sales',body],['inventoryLogs','/admin/vehicles/v/history'],['dashboard','/salesman/snapshot']]) {
   const samples=[];for(let n=0;n<30;n++)samples.push(await measure(path,payload));
   metrics[label]={p50Ms:percentile(samples.map(s=>s.ms),.5),p95Ms:percentile(samples.map(s=>s.ms),.95),p99Ms:percentile(samples.map(s=>s.ms),.99),queries:samples[0].queries,responseBytes:samples.at(-1).bytes};
  }
  metrics.logPlan=(await db.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT l.*,p.name AS product_name FROM stock_ledger l JOIN products p ON p.id=l.product_id WHERE l.location_id='v' ORDER BY l.timestamp DESC"+(name==='after'?',l.id DESC':'')+' LIMIT 200')).rows[0]['QUERY PLAN'];
  results.runs[name]=metrics;
 } finally { if(server)await new Promise(r=>server.close(r));await db?.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
}
await admin.end();await fs.rm(dir,{recursive:true});
await fs.writeFile(new URL('../../PERFORMANCE-RESULTS.json',import.meta.url),JSON.stringify(results,null,2));
console.log(JSON.stringify(results.runs,null,2));
