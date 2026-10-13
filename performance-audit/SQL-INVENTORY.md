# Complete SQL call-site inventory

Generated from the active runtime and migration entrypoints; excludes obsolete `.orig`, patch scripts and tests. Dynamic SQL expressions and parameters are preserved from source. No database values are included. See REPORT.md for risk classification.

## Q1: backend/index.js:35

```js
client.query(
    'INSERT INTO audit_log (id, timestamp, action, entity, details) VALUES ($1, $2, $3, $4, $5)',
    [crypto.randomUUID(), Date.now(), action, entity, details]
  )
```

## Q2: backend/index.js:43

```js
pool.query('SELECT NOW()')
```

## Q3: backend/index.js:44

```js
pool.query('ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)')
```

## Q4: backend/index.js:45

```js
pool.query('ALTER TABLE salesmen ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE')
```

## Q5: backend/index.js:48

```js
client.query('BEGIN')
```

## Q6: backend/index.js:49

```js
client.query(`CREATE TABLE IF NOT EXISTS inventory_imports (
      id VARCHAR(50) PRIMARY KEY, timestamp BIGINT NOT NULL,
      import_ref VARCHAR(255) UNIQUE NOT NULL, supplier_name VARCHAR(255), godown_id VARCHAR(50)
    )`)
```

## Q7: backend/index.js:53

```js
client.query(fs.readFileSync(path.join(backendDir, 'migrations/001_inventory_import.sql'), 'utf8'))
```

## Q8: backend/index.js:54

```js
client.query(fs.readFileSync(path.join(backendDir, 'migrations/002_production_integrity.sql'), 'utf8'))
```

## Q9: backend/index.js:55

```js
client.query(fs.readFileSync(path.join(backendDir, 'migrations/003_tax_settings.sql'), 'utf8'))
```

## Q10: backend/index.js:56

```js
client.query(fs.readFileSync(path.join(backendDir, 'migrations/004_stock_requests.sql'), 'utf8'))
```

## Q11: backend/index.js:57

```js
client.query(fs.readFileSync(path.join(backendDir, 'migrations/005_performance_indexes.sql'), 'utf8'))
```

## Q12: backend/index.js:58

```js
client.query('COMMIT')
```

## Q13: backend/index.js:60

```js
client.query('ROLLBACK')
```

## Q14: backend/index.js:145

```js
client.query('BEGIN')
```

## Q15: backend/index.js:146

```js
client.query('SELECT id FROM godowns WHERE id = $1 AND active = TRUE FOR SHARE', [godownId])
```

## Q16: backend/index.js:148

```js
client.query('SELECT * FROM products WHERE id = ANY($1::varchar[]) ORDER BY id FOR SHARE', [[...new Set(ids)].sort()])
```

## Q17: backend/index.js:177

```js
client.query(`INSERT INTO inventory_imports
      (id, timestamp, import_ref, supplier_name, godown_id, invoice_date, supplier_gstin, reviewed_lines)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, Date.now(), importRef, supplier, godownId, invoiceDate, gstin?.toUpperCase() || null, JSON.stringify(lines)])
```

## Q18: backend/index.js:182

```js
client.query(`INSERT INTO stock_ledger
        (id, timestamp, type, product_id, quantity_pieces, location_id, reference_id, reason, note)
        VALUES ($1,$2,'LOAD_IN',$3,$4,$5,$6,'INVENTORY_IMPORT',$7)`,
        [`led_${crypto.randomUUID()}`, Date.now(), line.product_id, line.quantity_pieces, godownId, id, `Import Ref: ${importRef}`])
```

## Q19: backend/index.js:188

```js
client.query('COMMIT')
```

## Q20: backend/index.js:191

```js
client.query('ROLLBACK')
```

## Q21: backend/index.js:252

```js
pool.query('SELECT * FROM products WHERE active = TRUE')
```

## Q22: backend/operations.js:21

```js
client.query('BEGIN')
```

## Q23: backend/operations.js:21

```js
client.query('COMMIT')
```

## Q24: backend/operations.js:22

```js
client.query('ROLLBACK')
```

## Q25: backend/operations.js:25

```js
c.query('INSERT INTO audit_log(id,timestamp,action,entity,details) VALUES($1,$2,$3,$4,$5)', [uid(),Date.now(),action,entity,{...details,actor_id:auditContext.getStore()?.id}])
```

## Q26: backend/operations.js:27

```js
c.query(`SELECT ${sumSQL} AS qty FROM stock_ledger WHERE location_id=$1 AND product_id=$2`, [location, product])
```

## Q27: backend/operations.js:30

```js
c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['stock:' + key])
```

## Q28: backend/operations.js:34

```js
c.query('INSERT INTO stock_ledger(id,timestamp,type,product_id,quantity_pieces,location_id,reference_id,work_day_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uid(),Date.now(),type,product,integer(quantity,'Quantity',1),location,ref,day || null,reason || null])
```

## Q29: backend/operations.js:40

```js
c.query('SELECT * FROM products WHERE id=ANY($1::varchar[]) ORDER BY id FOR SHARE', [ids])
```

## Q30: backend/operations.js:49

```js
c.query('SELECT id FROM godowns WHERE id=$1 AND active=TRUE FOR SHARE',[id])
```

## Q31: backend/operations.js:52

```js
c.query('SELECT * FROM work_days WHERE work_day_id=$1 FOR UPDATE',[id])
```

## Q32: backend/operations.js:67

```js
c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`operation:${req.user.id}:${key}`])
```

## Q33: backend/operations.js:68

```js
c.query('SELECT * FROM api_operations WHERE actor_id=$1 AND request_key=$2',[req.user.id,key])
```

## Q34: backend/operations.js:71

```js
c.query('INSERT INTO api_operations(actor_id,request_key,operation,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[req.user.id,key,name,hash,JSON.stringify(result)])
```

## Q35: backend/operations.js:83

```js
c.query('SELECT * FROM products ORDER BY name')
```

## Q36: backend/operations.js:84

```js
c.query('SELECT w.*,s.name AS salesman_name,v.name AS vehicle_name,g.name AS godown_name FROM work_days w JOIN salesmen s ON s.id=w.salesman_id JOIN vehicles v ON v.id=w.vehicle_id JOIN godowns g ON g.id=w.godown_id WHERE w.salesman_id=$1 ORDER BY w.opened_at DESC',[user.id])
```

## Q37: backend/operations.js:86

```js
c.query('SELECT i.*, s.name as salesman_name, s.phone as salesman_phone FROM invoices i LEFT JOIN salesmen s ON i.salesman_id = s.id WHERE i.salesman_id=$1 ORDER BY i.created_at',[user.id])
```

## Q38: backend/operations.js:87

```js
c.query('SELECT * FROM sale_items WHERE invoice_id=ANY($1::varchar[])',[rawInvoices.map(i=>i.id)])
```

## Q39: backend/operations.js:89

```js
c.query('SELECT v.id,v.godown_id FROM vehicles v JOIN salesmen s ON s.vehicle_id=v.id WHERE s.id=$1 AND v.active=TRUE',[user.id])
```

## Q40: backend/operations.js:92

```js
c.query('SELECT * FROM stock_ledger WHERE work_day_id=ANY($1::varchar[]) OR location_id=ANY($2::varchar[])',[ids,locations])
```

## Q41: backend/operations.js:94

```js
c.query("SELECT response FROM api_operations WHERE actor_id=$1 AND operation='load' ORDER BY created_at",[user.id])
```

## Q42: backend/operations.js:95

```js
c.query('SELECT * FROM accounting_ledger WHERE work_day_id=ANY($1::varchar[])',[ids])
```

## Q43: backend/operations.js:96

```js
c.query('SELECT * FROM customers ORDER BY name')
```

## Q44: backend/operations.js:97

```js
c.query("SELECT data FROM app_settings WHERE id='tax'")
```

## Q45: backend/operations.js:110

```js
pool.query(req.params.table === 'vehicles' ? 'SELECT v.*,g.location_name FROM vehicles v LEFT JOIN godowns g ON g.id=v.godown_id ORDER BY v.name' : `SELECT * FROM ${req.params.table} ORDER BY name`)
```

## Q46: backend/operations.js:115

```js
c.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[req.params.id])
```

## Q47: backend/operations.js:129

```js
c.query('SELECT id FROM vehicles WHERE id=$1 AND active=TRUE',[data.vehicle_id])
```

## Q48: backend/operations.js:134

```js
c.query(`SELECT 1 FROM work_days WHERE ${column}=$1 AND state<>'CLOSED'`,[id])
```

## Q49: backend/operations.js:137

```js
c.query(sql,[...vals,id])
```

## Q50: backend/operations.js:139

```js
c.query('DELETE FROM auth_sessions WHERE user_id=$1',[id])
```

## Q51: backend/operations.js:147

```js
c.query('UPDATE salesmen SET password_hash=$1 WHERE id=$2 RETURNING id',[hashPassword(password),req.params.id])
```

## Q52: backend/operations.js:149

```js
c.query('DELETE FROM auth_sessions WHERE user_id=$1',[req.params.id])
```

## Q53: backend/operations.js:152

```js
pool.query(`SELECT p.id AS product_id,p.name AS product_name,p.price_paise,p.pieces_per_box,p.strips_per_box,p.units_per_strip,(${sumSQL.replaceAll('type','l.type').replaceAll('quantity_pieces','l.quantity_pieces')})::integer AS quantity_pieces FROM products p LEFT JOIN stock_ledger l ON l.product_id=p.id AND l.location_id=$1 GROUP BY p.id ORDER BY p.name`,[req.params.id])
```

## Q54: backend/operations.js:153

```js
pool.query('SELECT l.*,p.name AS product_name FROM stock_ledger l JOIN products p ON p.id=l.product_id WHERE l.location_id=$1 ORDER BY l.timestamp DESC LIMIT 200',[req.params.id])
```

## Q55: backend/operations.js:154

```js
pool.query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 200')
```

## Q56: backend/operations.js:177

```js
pool.query(
      `SELECT 
         COALESCE(SUM(total_amount_paise), 0) AS total_sales,
         COUNT(id) AS total_orders,
         COUNT(DISTINCT customer_id) AS unique_customers
       FROM invoices 
       WHERE status='VALID' AND ${dateFilter}`, params
    )
```

## Q57: backend/operations.js:186

```js
pool.query(
      `SELECT id, invoice_number, created_at, customer_name, total_amount_paise, payment_mode, status
       FROM invoices 
       WHERE status='VALID' AND ${dateFilter} 
       ORDER BY created_at DESC`, params
    )
```

## Q58: backend/operations.js:216

```js
c.query('SELECT strips_per_box, units_per_strip FROM products WHERE id=$1 FOR SHARE', [product_id])
```

## Q59: backend/operations.js:229

```js
c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
```

## Q60: backend/operations.js:231

```js
c.query('SELECT * FROM salesmen WHERE id=$1 FOR UPDATE',[req.user.id])
```

## Q61: backend/operations.js:232

```js
c.query('SELECT * FROM vehicles WHERE id=$1 AND active=TRUE FOR UPDATE',[person.vehicle_id])
```

## Q62: backend/operations.js:235

```js
c.query("SELECT * FROM work_days WHERE (salesman_id=$1 OR vehicle_id=$2) AND state<>'CLOSED'",[person.id,vehicle.id])
```

## Q63: backend/operations.js:237

```js
c.query("SELECT * FROM work_days WHERE vehicle_id=$1 AND state='CLOSED' ORDER BY closed_at DESC LIMIT 1",[vehicle.id])
```

## Q64: backend/operations.js:238

```js
c.query('SELECT * FROM products ORDER BY id')
```

## Q65: backend/operations.js:242

```js
c.query('INSERT INTO work_days(work_day_id,calendar_date,salesman_id,vehicle_id,godown_id,opened_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,dateString(),person.id,vehicle.id,vehicle.godown_id,now,{openingStockSnapshot:opening,pricesSnapshot:prices,heldDays,historicalStockLevels:previous?.metadata?.historicalStockLevels||{}}])
```

## Q66: backend/operations.js:250

```js
c.query("UPDATE work_days SET state=$2::day_state,route_started_at=CASE WHEN $2::day_state='ON_ROUTE' THEN COALESCE(route_started_at,$3) ELSE route_started_at END WHERE work_day_id=$1",[d.work_day_id,target,Date.now()])
```

## Q67: backend/operations.js:275

```js
c.query(
      'INSERT INTO stock_requests(id,work_day_id,salesman_id,vehicle_id,godown_id,status,items,requested_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, d.work_day_id, d.salesman_id, d.vehicle_id, d.godown_id, 'PENDING', JSON.stringify(itemRecords), now]
    )
```

## Q68: backend/operations.js:284

```js
pool.query(
      `SELECT sr.*, g.name AS godown_name, v.name AS vehicle_name 
       FROM stock_requests sr 
       LEFT JOIN godowns g ON g.id=sr.godown_id 
       LEFT JOIN vehicles v ON v.id=sr.vehicle_id 
       WHERE sr.salesman_id=$1 
       ORDER BY sr.requested_at DESC LIMIT 50`,
      [req.user.id]
    )
```

## Q69: backend/operations.js:310

```js
pool.query(
      `SELECT sr.*, s.name AS salesman_name, v.name AS vehicle_name, g.name AS godown_name 
       FROM stock_requests sr 
       JOIN salesmen s ON s.id=sr.salesman_id 
       JOIN vehicles v ON v.id=sr.vehicle_id 
       JOIN godowns g ON g.id=sr.godown_id 
       ORDER BY sr.requested_at DESC LIMIT 200`
    )
```

## Q70: backend/operations.js:336

```js
c.query('SELECT * FROM stock_requests WHERE id=$1 FOR UPDATE', [req.params.id])
```

## Q71: backend/operations.js:341

```js
c.query('SELECT * FROM work_days WHERE work_day_id=$1 FOR UPDATE', [reqRow.work_day_id])
```

## Q72: backend/operations.js:364

```js
c.query('UPDATE stock_requests SET status=$1, processed_at=$2 WHERE id=$3', ['APPROVED', now, reqRow.id])
```

## Q73: backend/operations.js:370

```js
c.query('SELECT * FROM stock_requests WHERE id=$1 FOR UPDATE', [req.params.id])
```

## Q74: backend/operations.js:378

```js
c.query('UPDATE stock_requests SET status=$1, processed_at=$2, admin_note=$3 WHERE id=$4', ['REJECTED', now, note, reqRow.id])
```

## Q75: backend/operations.js:384

```js
c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customer:'+mobile])
```

## Q76: backend/operations.js:385

```js
c.query('SELECT id FROM customers WHERE mobile=$1',[mobile])
```

## Q77: backend/operations.js:387

```js
c.query('INSERT INTO customers(id,name,mobile,shop_name,area,credit_limit_paise) VALUES($1,$2,$3,$4,$5,$6)',[id,text(b.name,'Name'),mobile,b.shopName?text(b.shopName,'Shop'):null,b.area?text(b.area,'Area'):null,b.creditLimitPaise==null?null:integer(b.creditLimitPaise,'Credit limit')])
```

## Q78: backend/operations.js:395

```js
c.query("SELECT data FROM app_settings WHERE id='tax'")
```

## Q79: backend/operations.js:405

```js
c.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE',[b.customerId])
```

## Q80: backend/operations.js:411

```js
c.query('INSERT INTO invoices(id,invoice_number,created_at,calendar_date,work_day_id,salesman_id,vehicle_id,outlet_id,customer_id,customer_name,total_amount_paise,payment_mode,payment_ref,previous_balance_paise,new_balance_paise,cgst_percent,sgst_percent,cgst_amount_paise,sgst_amount_paise,subtotal_paise) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',[id,invoiceNumber,timestamp,d.calendar_date,d.work_day_id,d.salesman_id,d.vehicle_id,customer?.id||null,customer?.id||null,customer?.name||'Walk-in',grand_total,b.paymentMode,b.paymentRef||null,before,after,cgst_percent,sgst_percent,cgst_amount_paise,sgst_amount_paise,total])
```

## Q81: backend/operations.js:412

```js
c.query('INSERT INTO sale_items(invoice_id,product_id,quantity_pieces,line_total_paise,product_snapshot) VALUES($1,$2,$3,$4,$5)',[id,i.productId,i.quantityPieces,i.lineTotalPaise,productDto(i.product)])
```

## Q82: backend/operations.js:413

```js
c.query('INSERT INTO accounting_ledger(id,timestamp,type,amount_paise,customer_id,invoice_id,work_day_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),timestamp,'SALES_'+b.paymentMode,grand_total,customer?.id||null,id,d.work_day_id])
```

## Q83: backend/operations.js:414

```js
c.query("INSERT INTO accounting_ledger(id,timestamp,type,amount_paise,customer_id,invoice_id,work_day_id) VALUES($1,$2,'CUSTOMER_RECEIVABLE',$3,$4,$5,$6)",[uid(),timestamp,grand_total,customer.id,id,d.work_day_id])
```

## Q84: backend/operations.js:415

```js
c.query('UPDATE customers SET outstanding_balance_paise=$2,last_sold_timestamp=$3 WHERE id=$1',[customer.id,after,timestamp])
```

## Q85: backend/operations.js:416

```js
c.query('UPDATE work_days SET invoice_counter=$2 WHERE work_day_id=$1',[d.work_day_id,counter])
```

## Q86: backend/operations.js:419

```js
c.query('SELECT * FROM invoices WHERE id=$1 AND salesman_id=$2',[req.params.id,req.user.id])
```

## Q87: backend/operations.js:421

```js
c.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[invoice.id])
```

## Q88: backend/operations.js:422

```js
c.query('SELECT * FROM sale_items WHERE invoice_id=$1',[i.id])
```

## Q89: backend/operations.js:424

```js
c.query('INSERT INTO accounting_ledger(id,timestamp,type,amount_paise,customer_id,invoice_id,work_day_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),Date.now(),type,i.total_amount_paise,i.customer_id,i.id,i.work_day_id])
```

## Q90: backend/operations.js:425

```js
c.query('UPDATE customers SET outstanding_balance_paise=outstanding_balance_paise-$2 WHERE id=$1',[i.customer_id,i.total_amount_paise])
```

## Q91: backend/operations.js:426

```js
c.query("UPDATE invoices SET status='VOID' WHERE id=$1",[i.id])
```

## Q92: backend/operations.js:431

```js
c.query('SELECT * FROM products ORDER BY id')
```

## Q93: backend/operations.js:438

```js
c.query("SELECT * FROM invoices WHERE work_day_id=$1 AND status='VALID'",[d.work_day_id])
```

## Q94: backend/operations.js:442

```js
c.query("SELECT COALESCE(SUM(quantity_pieces),0) AS qty FROM stock_ledger WHERE work_day_id=$1 AND location_id=$2 AND product_id=$3 AND type='LOAD_IN'",[d.work_day_id,d.vehicle_id,p.id])
```

## Q95: backend/operations.js:446

```js
c.query("SELECT s.product_id,SUM(s.line_total_paise) AS total FROM sale_items s JOIN invoices i ON i.id=s.invoice_id WHERE i.work_day_id=$1 AND i.status='VALID' GROUP BY s.product_id",[d.work_day_id])
```

## Q96: backend/operations.js:449

```js
c.query("UPDATE work_days SET state='UNLOAD_REQUESTED',cash_collected_paise=$2,request_data=$3,requested_at=$4,metadata=metadata||$5::jsonb WHERE work_day_id=$1",[d.work_day_id,cash,data,Date.now(),JSON.stringify({heldItems:held,unloadedItems:unloaded,cashBreakdown:breakdown,cashTotalPaise:cash,noteCount:b.noteCount,coinCount:b.coinCount,dayStockReportSnapshot:Object.fromEntries(rows.map(r=>[r.productId,r]))})])
```

## Q97: backend/operations.js:452

```js
pool.query('SELECT * FROM work_days WHERE request_data IS NOT NULL ORDER BY requested_at DESC LIMIT 200')
```

## Q98: backend/operations.js:455

```js
c.query("UPDATE work_days SET state='SENT_BACK',admin_note=$2 WHERE work_day_id=$1",[d.work_day_id,note])
```

## Q99: backend/operations.js:460

```js
c.query("SELECT COALESCE(SUM(total_amount_paise),0) AS cash FROM invoices WHERE work_day_id=$1 AND status='VALID' AND payment_mode='CASH'",[d.work_day_id])
```

## Q100: backend/operations.js:464

```js
c.query("UPDATE work_days SET state='CLOSED',closed_at=$2,admin_note='Job cleared',metadata=metadata||$3::jsonb WHERE work_day_id=$1",[d.work_day_id,Date.now(),JSON.stringify({historicalStockLevels:history})])
```

## Q101: backend/operations.js:466

```js
pool.query("SELECT data FROM app_settings WHERE id=$1", ["tax"])
```

## Q102: backend/operations.js:467

```js
pool.query("SELECT data FROM app_settings WHERE id=$1", ["tax"])
```

## Q103: backend/operations.js:470

```js
pool.query("UPDATE app_settings SET data=jsonb_build_object('cgst', $1::numeric, 'sgst', $2::numeric) WHERE id=$3", [cgst, sgst, "tax"])
```

## Q104: backend/security.js:36

```js
pool.query('SELECT * FROM salesmen WHERE phone=$1', [String(body.mobile || '')])
```

## Q105: backend/security.js:41

```js
pool.query('INSERT INTO auth_sessions(token_hash,user_id,role,expires_at) VALUES($1,$2,$3,now()+interval \'12 hours\')', [digest(token), user.id, role])
```

## Q106: backend/security.js:64

```js
pool.query('SELECT * FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()', [digest(token)])
```

## Q107: backend/security.js:69

```js
pool.query('SELECT * FROM salesmen WHERE id=$1 AND active=TRUE AND status=\'ACTIVE\'', [session.user_id])
```

## Q108: backend/security.js:81

```js
pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [digest(req.headers.authorization.slice(7))])
```

## Q109: backend/migrate.js:5

```js
pool.query("SELECT to_regclass('products') AS table_name")
```

## Q110: backend/migrate.js:6

```js
pool.query(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
```
