import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import express from 'express';
import { installOperations, transaction } from '../operations.js';
import { nextInvoiceSequence, invoiceDate } from '../billing.js';

const read = name => fs.readFileSync(new URL(name,import.meta.url),'utf8');
test('migration preserves history; concurrent daily bills, snapshots, undo and rounded cash close', {skip:!process.env.TEST_DATABASE_URL}, async () => {
  const schema='billing_'+crypto.randomBytes(6).toString('hex');
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  let db,server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,max:12});
    await db.query(read('../../schema.sql'));
    // Reconstruct the pre-upgrade invoice schema and one previously printed bill.
    await db.query(`ALTER TABLE invoices DROP COLUMN business_name, DROP COLUMN gstin,
      DROP COLUMN invoice_date, DROP COLUMN invoice_seq;
      ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE(invoice_number);`);
    for(const file of fs.readdirSync(new URL('../migrations/',import.meta.url)).sort().filter(f=>f<'009')) await db.query(read('../migrations/'+file));
    await db.query("INSERT INTO godowns(id,name) VALUES('g','Warehouse'); INSERT INTO vehicles(id,name,godown_id) VALUES('v','Van','g'); INSERT INTO salesmen(id,name,vehicle_id) VALUES('s','Seller','v'),('other','Other',NULL)");
    await db.query("INSERT INTO products(id,name,price_paise) VALUES('p','Item',12345); INSERT INTO work_days(work_day_id,calendar_date,salesman_id,vehicle_id,godown_id,state,metadata) VALUES('d','2020-01-01','s','v','g','ON_ROUTE','{}')");
    await db.query("INSERT INTO invoices(id,invoice_number,created_at,calendar_date,work_day_id,salesman_id,vehicle_id,total_amount_paise,payment_mode) VALUES('old','legacy-uuid-number',1577858400000,'2020-01-01','d','s','v',12400,'CASH')");
    const migration=read('../migrations/009_inclusive_billing.sql');
    await db.query(migration);
    const old=(await db.query("SELECT * FROM invoices WHERE id='old'")).rows[0];
    assert.equal(old.invoice_number,'legacy-uuid-number'); assert.equal(old.business_name,'FMCG Van Sales');assert.equal(old.gstin,'');assert.equal(Number(old.total_amount_paise),12400);
    for(const field of ['cgst_percent','sgst_percent','cgst_amount_paise','sgst_amount_paise','round_off_paise','subtotal_paise'])assert.equal(field in old,false);
    // Historical invoice is retained but excluded from this work day's close.
    await db.query("UPDATE invoices SET status='VOID' WHERE id='old'; INSERT INTO stock_ledger(id,timestamp,type,product_id,quantity_pieces,location_id,work_day_id) VALUES('stock',1,'LOAD_IN','p',100,'v','d')");
    const app=express();app.use(express.json());
    app.use((req,_res,next)=>{req.user={id:req.headers['x-role']==='admin'?'admin':'s',role:req.headers['x-role']||'salesman',name:'Seller'};next();});
    installOperations(app,db);
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}/api/v2`;
    const call=async(path,body,method='POST',role='salesman',key=crypto.randomUUID())=>{
      const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key,'x-role':role},body:body===undefined?undefined:JSON.stringify(body)});
      const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
    };
    await call('/admin/settings/business',{businessName:'First Store',gstin:'27ABCDE1234F1Z5'},'PUT','admin');
    const sale={workDayId:'d',paymentMode:'CASH',totalAmountPaise:12300,items:[{productId:'p',quantityPieces:1}]};
    const bills=await Promise.all(Array.from({length:8},()=>call('/salesman/sales',sale)));
    assert.deepEqual(bills.map(b=>b.invoiceSeq).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
    assert.ok(bills.every(b=>b.invoiceDate===invoiceDate(Date.now()))); // Not the stale work-day date.
    const first=bills.find(b=>b.invoiceSeq===1);
    await call(`/salesman/invoices/${first.id}/cancel`,{});
    await call(`/salesman/invoices/${first.id}/cancel`,{});
    const next=await call('/salesman/sales',sale);assert.equal(next.invoiceNumber,'9');
    await call('/admin/settings/business',{businessName:'Second Store',gstin:'29ABCDE1234F1Z5'},'PUT','admin');
    const reprint=await call(`/salesman/invoices/${first.id}`,undefined,'GET');
    assert.equal(reprint.status,'VOID');assert.equal(reprint.businessName,'First Store');assert.equal(reprint.gstin,'27ABCDE1234F1Z5');assert.equal('vehicleId' in reprint,false);
    const latest=await call('/salesman/sales',sale);assert.equal(latest.businessName,'Second Store');assert.equal(latest.invoiceNumber,'10');
    // The database constraint applies to VOID records as well.
    await assert.rejects(db.query('UPDATE invoices SET invoice_seq=1 WHERE id=$1',[latest.id]),{code:'23505'});
    // Another salesman and another IST date each start from 1, and rollback returns the slot.
    assert.equal(await transaction(db,c=>nextInvoiceSequence(c,'other',invoiceDate(Date.now()))),1);
    assert.equal(await transaction(db,c=>nextInvoiceSequence(c,'s','2030-01-01')),1);
    await assert.rejects(transaction(db,async c=>{await nextInvoiceSequence(c,'s','2030-01-01');throw new Error('rollback');}),/rollback/);
    assert.equal(await transaction(db,c=>nextInvoiceSequence(c,'s','2030-01-01')),2);
    await db.query(migration); // Re-running must not replace saved identity or rewind counters.
    const persisted=await call(`/salesman/invoices/${first.id}`,undefined,'GET');assert.equal(persisted.businessName,'First Store');
    const cash=9*12300;
    const streamController=new AbortController();
    const stream=await fetch(base+'/day-events',{signal:streamController.signal});
    const reader=stream.body.getReader();await reader.read(); // Initial revalidation.
    try {
      await call('/unload-requests',{workDayId:'d',cashCollected:cash,cashBreakdown:{NOTE_500:2,NOTE_100:1,COIN_5:1,COIN_2:1},heldItems:{p:91},unloadedItems:{}});
      const update=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Missing day update')),2000).unref())]);
      assert.match(new TextDecoder().decode(update.value),/data: changed/);
    } finally { streamController.abort(); await reader.cancel().catch(()=>{}); }
    const pending=await call('/unload-requests',undefined,'GET','admin');assert.equal(pending[0].status,'PENDING');assert.equal(pending[0].request_data.paymentTotals.total,cash);
    await call('/unload-requests/d/approve',{},'POST','admin');
    const snapshot=await call('/salesman/snapshot',undefined,'GET');
    assert.equal(snapshot.workDays[0].state,'CLOSED');assert.equal(snapshot.workDays[0].totalSalesPaise,cash);assert.equal(snapshot.workDays[0].cashCollectedPaise,cash);
    assert.equal((await call('/unload-requests',undefined,'GET','admin'))[0].status,'APPROVED');
  } finally {
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await db?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
  }
});
