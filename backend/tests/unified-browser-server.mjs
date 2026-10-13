// Disposable local UI verification; no .env loading or remote database fallback.
import fs from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installSecurity,hashPassword } from '../security.js';
import { installOperations } from '../operations.js';
const url=process.env.TEST_DATABASE_URL;
if(!url || new URL(url).hostname!=='127.0.0.1')throw new Error('Loopback TEST_DATABASE_URL required');
const schema='ui_'+crypto.randomBytes(6).toString('hex');
const admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);
const db=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
await db.query(await fs.readFile(new URL('../../schema.sql',import.meta.url),'utf8'));
for(const file of (await fs.readdir(new URL('../migrations/',import.meta.url))).sort())await db.query(await fs.readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
process.env.ADMIN_PASSWORD_HASH=hashPassword('local-test-password');
await db.query("INSERT INTO godowns(id,name) VALUES('g','Test warehouse'); INSERT INTO vehicles(id,name,godown_id) VALUES('v','Test van','g');");
await db.query("INSERT INTO salesmen(id,name,phone,vehicle_id,password_hash) VALUES('s','Test seller','9888888888','v',$1)",[hashPassword('local-test-password')]);
await db.query("INSERT INTO products(id,name,price_paise,units_per_strip,strips_per_box,pieces_per_box) VALUES('p','Test product',12535,1,1,1); INSERT INTO work_days(work_day_id,calendar_date,salesman_id,vehicle_id,godown_id,state,opened_at) VALUES('d',CURRENT_DATE,'s','v','g','ON_ROUTE',1); INSERT INTO stock_ledger(id,timestamp,type,product_id,quantity_pieces,location_id,work_day_id) VALUES('l',1,'LOAD_IN','p',100,'v','d')");
await db.query(`UPDATE work_days SET metadata=' {"openingStockSnapshot":{},"pricesSnapshot":{"p":12535},"heldDays":{},"historicalStockLevels":{}}'`);
const app=express();app.use(express.json());installSecurity(app,db);installOperations(app,db);
const dist=fileURLToPath(new URL('../../dist/',import.meta.url));app.use(express.static(dist));
app.get('/salesman/*',(_req,res)=>res.sendFile(dist+'salesman/index.html'));
app.get('*',(_req,res)=>res.sendFile(dist+'index.html'));
const server=app.listen(55801,'127.0.0.1',()=>console.log('Local unified UI ready on 55801'));
async function cleanup(){await new Promise(r=>server.close(r));await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();process.exit();}
process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);
