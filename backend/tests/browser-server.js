// Explicitly opt-in: disposable database and localhost-only browser acceptance server.
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { installSecurity,hashPassword } from '../security.js';
import { installOperations } from '../operations.js';
if(process.env.RUN_BROWSER_ACCEPTANCE!=='1')throw new Error('Set RUN_BROWSER_ACCEPTANCE=1 to create isolated fixtures.');
dotenv.config({path:new URL('../.env',import.meta.url),quiet:true});
process.env.NODE_ENV='test';
const {extractInvoicePdf,saveInventoryImport,matchInvoiceItem,pool:unusedPool}=await import('../index.js');
await unusedPool.end();
const schema='browser_test_'+crypto.randomBytes(8).toString('hex');
const url=new URL(process.env.DATABASE_URL);if(url.hostname.endsWith('.neon.tech'))url.hostname=url.hostname.replace('-pooler.','.');
const admin=new pg.Pool({connectionString:url.toString(),connectionTimeoutMillis:30000});
await admin.query(`CREATE SCHEMA ${schema}`);
const db=new pg.Pool({connectionString:url.toString(),options:`-c search_path=${schema}`,connectionTimeoutMillis:30000});
let server;
async function cleanup(){await new Promise(r=>server?server.close(r):r());await db.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
try {
 await db.query(fs.readFileSync(new URL('../../schema.sql',import.meta.url),'utf8'));
 for(const file of fs.readdirSync(new URL('../migrations/',import.meta.url)).sort())await db.query(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const password=crypto.randomBytes(20).toString('hex');process.env.ADMIN_PASSWORD_HASH=hashPassword(password);
 await db.query("INSERT INTO godowns(id,name) VALUES('test-godown','Acceptance Godown')");
 await db.query("INSERT INTO vehicles(id,name,godown_id) VALUES('test-vehicle','Acceptance Vehicle','test-godown')");
 await db.query("INSERT INTO salesmen(id,name,phone,password_hash,vehicle_id) VALUES('test-salesman','Acceptance Salesman','9777777777',$1,'test-vehicle')",[hashPassword(password)]);
 const pdf=fs.readFileSync(new URL('../../ideal_invoice.pdf',import.meta.url)).toString('base64');
 const extraction=await extractInvoicePdf(pdf);
 for(const [i,item]of extraction.items.entries())await db.query('INSERT INTO products(id,name,price_paise,units_per_strip,strips_per_box,pieces_per_box) VALUES($1,$2,100,5,2,10)',[`test-product-${i}`,item.description]);
 fs.writeFileSync('/private/tmp/dashboard-browser-fixture.json',JSON.stringify({password,username:'admin',mobile:'9777777777',schema}),{mode:0o600});
 const app=express();app.use(cors({origin:['http://localhost:5175','http://localhost:5176']}));app.use(express.json({limit:'50mb'}));installSecurity(app,db);installOperations(app,db);
 app.post('/api/v2/admin/extract-invoice',async(req,res)=>{try{const data=await extractInvoicePdf(req.body.fileBase64);const products=(await db.query('SELECT * FROM products')).rows;data.items=data.items.map(i=>matchInvoiceItem(i,products));res.status(data.success?200:422).json(data);}catch(e){res.status(400).json({error:e.message});}});
 app.post('/api/v2/admin/inventory/import',async(req,res)=>{try{res.json(await saveInventoryImport(req.body,db));}catch(e){res.status(e.status||400).json({error:e.message});}});
 server=app.listen(8100,'127.0.0.1',()=>console.log('Isolated browser acceptance API ready on 8100.'));
 process.on('SIGTERM',()=>void cleanup().then(()=>process.exit()));process.on('SIGINT',()=>void cleanup().then(()=>process.exit()));
}catch(e){await cleanup();throw e;}
