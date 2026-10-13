import crypto from 'node:crypto';
import { logPage } from './log-pagination.js';
import { calculateBill } from './billing.js';
import { AsyncLocalStorage } from 'node:async_hooks';
const auditContext = new AsyncLocalStorage();
import { hashPassword, safeUser } from './security.js';

export class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const uid = () => crypto.randomUUID();
const number = n => Number(n || 0);
const dateString = d => typeof d === 'string' ? d.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric',month:'2-digit',day:'2-digit' }).format(d || new Date());
const sumSQL = `COALESCE(SUM(CASE WHEN type IN ('LOAD_IN','UNLOAD_IN','SALE_CANCEL','ADJ_PLUS') THEN quantity_pieces WHEN type IN ('LOAD_OUT','UNLOAD_OUT','SALE','ADJ_MINUS') THEN -quantity_pieces ELSE 0 END),0)`;
export function integer(value, label, min = 0, max = 2147483647) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new ApiError(`${label} must be a whole number between ${min} and ${max}.`);
  return Number(value);
}
function text(value, label, required = true, max = 255) {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw new ApiError(`${label} is required or invalid.`);
  return value.trim();
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}
const audit = (c, action, entity, details = {}) => c.query('INSERT INTO audit_log(id,timestamp,action,entity,details) VALUES($1,$2,$3,$4,$5)', [uid(),Date.now(),action,entity,{...details,actor_id:auditContext.getStore()?.id}]);
export async function balance(c, location, product) {
  return number((await c.query(`SELECT ${sumSQL} AS qty FROM stock_ledger WHERE location_id=$1 AND product_id=$2`, [location, product])).rows[0].qty);
}
async function lockStock(c, locations, products) {
  for (const key of locations.flatMap(l => products.map(p => `${l}:${p}`)).sort()) await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['stock:' + key]);
}
async function ledger(c, type, product, quantity, location, ref, day, reason) {
  if (!quantity) return;
  await c.query('INSERT INTO stock_ledger(id,timestamp,type,product_id,quantity_pieces,location_id,reference_id,work_day_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uid(),Date.now(),type,product,integer(quantity,'Quantity',1),location,ref,day || null,reason || null]);
}
async function productsFor(c, items) {
  if (!Array.isArray(items) || !items.length || items.length > 1000) throw new ApiError('Provide 1 to 1000 items.');
  const ids = items.map(i => text(i?.productId || i?.product_id, 'Product', true, 50));
  if (new Set(ids).size !== ids.length) throw new ApiError('Combine duplicate product rows.');
  const { rows } = await c.query('SELECT * FROM products WHERE id=ANY($1::varchar[]) ORDER BY id FOR SHARE', [ids]);
  const map = new Map(rows.map(p => [p.id, p]));
  return items.map((i, n) => {
    const product = map.get(ids[n]);
    if (!product?.active) throw new ApiError('Select an existing active product.');
    return { product, productId: product.id, quantityPieces: integer(i.quantityPieces ?? i.quantity_pieces,'Quantity',1) };
  });
}
async function activeGodown(c, id) {
  if (!(await c.query('SELECT id FROM godowns WHERE id=$1 AND active=TRUE FOR SHARE',[id])).rows.length) throw new ApiError('Select an active godown.');
}
async function ownDay(c, id, user, states) {
  const day = (await c.query('SELECT * FROM work_days WHERE work_day_id=$1 FOR UPDATE',[id])).rows[0];
  if (!day || user.role !== 'admin' && day.salesman_id !== user.id) throw new ApiError('Work day not found.',404);
  if (states && !states.includes(day.state)) throw new ApiError('This operation is not allowed in the current work-day state.',409);
  return day;
}
function endpoint(fn) { return (req,res) => auditContext.run(req.user, async () => { try { res.json(await fn(req)); } catch(e) {
  if (process.env.RUN_ISOLATED_DB_TESTS) console.error('Test operation failure:', e.code || e.status, e.message);
  const status = e.status || (e.code === '23505' ? 409 : e.code === '23503' ? 400 : 503);
  res.status(status).json({error:e instanceof ApiError ? e.message : e.code === '23505' ? 'This record or request already exists.' : e.code === '23503' ? 'A referenced record does not exist.' : 'Operation could not be completed. Please retry.'});
} }); }
export function operation(pool, req, name, fn) {
  const key = req.headers['idempotency-key'] || req.body?.idempotency_key;
  if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) throw new ApiError('A valid idempotency key is required.');
  const hash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  return transaction(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`operation:${req.user.id}:${key}`]);
    const prior = (await c.query('SELECT * FROM api_operations WHERE actor_id=$1 AND request_key=$2',[req.user.id,key])).rows[0];
    if (prior) { if (prior.operation !== name || prior.payload_hash !== hash) throw new ApiError('This request key was used for different data.',409); return prior.response; }
    const result = await fn(c);
    await c.query('INSERT INTO api_operations(actor_id,request_key,operation,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[req.user.id,key,name,hash,JSON.stringify(result)]);
    return result;
  });
}
function productDto(p) { return { id:p.id,name:p.name,pricePaise:number(p.price_paise),unitsPerStrip:p.units_per_strip,stripsPerBox:p.strips_per_box,piecesPerBox:p.pieces_per_box,active:p.active }; }
function customerDto(c) { return {id:c.id,name:c.name,mobile:c.mobile || '',shopName:c.shop_name,area:c.area,creditLimitPaise:c.credit_limit_paise === null ? undefined : number(c.credit_limit_paise),outstandingBalancePaise:number(c.outstanding_balance_paise),lastSoldTimestamp:number(c.last_sold_timestamp)}; }
function dayDto(d, invoices) {
  const valid = invoices.filter(i=>i.workDayId===d.work_day_id && i.status==='VALID');
  const total = mode => valid.filter(i=>!mode || i.paymentMode===mode).reduce((s,i)=>s+i.totalAmountPaise,0);
  return {...d.metadata,salesmanName:d.salesman_name,vehicleName:d.vehicle_name,warehouseName:d.godown_name, workDayId:d.work_day_id,calendarDate:dateString(d.calendar_date),state:d.state,salesmanId:d.salesman_id,vehicleId:d.vehicle_id,warehouseId:d.godown_id,routeId:d.route_id || '',openedAt:number(d.opened_at),routeStartedAt:number(d.route_started_at),closedAt:number(d.closed_at),cashCollectedPaise:number(d.cash_collected_paise),adminNote:d.admin_note,invoiceCounter:d.invoice_counter,totalSalesPaise:total(),cashSalesPaise:total('CASH'),upiSalesPaise:total('UPI'),creditSalesPaise:total('CREDIT'),numberOfBills:valid.length,itemsSold:valid.reduce((s,i)=>s+i.items.reduce((t,x)=>t+x.quantityPieces,0),0)};
}
function invoiceDto(i, items, user) { return {id:i.id,invoiceNumber:i.invoice_number,createdAt:number(i.created_at),calendarDate:dateString(i.calendar_date),workDayId:i.work_day_id,salesmanId:i.salesman_id,salesmanName:i.salesman_name || user.name || i.salesman_id,salesmanPhone:i.salesman_phone || user.phone || '',vehicleId:i.vehicle_id,outletId:i.outlet_id || '',customerId:i.customer_id,customerName:i.customer_name,totalAmountPaise:number(i.total_amount_paise),paymentMode:i.payment_mode,paymentRef:i.payment_ref,previousBalancePaise:number(i.previous_balance_paise),newBalancePaise:number(i.new_balance_paise),status:i.status,cgstPercent:number(i.cgst_percent),sgstPercent:number(i.sgst_percent),cgstAmountPaise:number(i.cgst_amount_paise),sgstAmountPaise:number(i.sgst_amount_paise),subtotalPaise:number(i.subtotal_paise),roundOffPaise:number(i.round_off_paise),items:items.map(x=>({productId:x.product_id,quantityPieces:x.quantity_pieces,lineTotalPaise:number(x.line_total_paise),productSnapshot:x.product_snapshot}))}; }
async function snapshot(c, user) {
  const products = (await c.query('SELECT * FROM products ORDER BY name')).rows.map(productDto);
  const days = (await c.query('SELECT w.*,s.name AS salesman_name,v.name AS vehicle_name,g.name AS godown_name FROM work_days w JOIN salesmen s ON s.id=w.salesman_id JOIN vehicles v ON v.id=w.vehicle_id JOIN godowns g ON g.id=w.godown_id WHERE w.salesman_id=$1 ORDER BY w.opened_at DESC',[user.id])).rows;
  const ids = days.map(d=>d.work_day_id);
  const rawInvoices = (await c.query('SELECT i.*, s.name as salesman_name, s.phone as salesman_phone FROM invoices i LEFT JOIN salesmen s ON i.salesman_id = s.id WHERE i.salesman_id=$1 ORDER BY i.created_at',[user.id])).rows;
  const items = (await c.query('SELECT * FROM sale_items WHERE invoice_id=ANY($1::varchar[])',[rawInvoices.map(i=>i.id)])).rows;
  const itemsByInvoice = new Map();
  for (const item of items) {
    if (!itemsByInvoice.has(item.invoice_id)) itemsByInvoice.set(item.invoice_id, []);
    itemsByInvoice.get(item.invoice_id).push(item);
  }
  const invoices = rawInvoices.map(i=>invoiceDto(i,itemsByInvoice.get(i.id)||[],user));
  const assignment = (await c.query('SELECT v.id,v.godown_id FROM vehicles v JOIN salesmen s ON s.vehicle_id=v.id WHERE s.id=$1 AND v.active=TRUE',[user.id])).rows[0];
  const locations = assignment ? [assignment.id,assignment.godown_id] : [];
  // Warehouse balances are shared; historical vehicle entries belong only to this user's work days.
  const rawLedger = (await c.query('SELECT * FROM stock_ledger WHERE work_day_id=ANY($1::varchar[]) OR location_id=ANY($2::varchar[])',[ids,locations])).rows;
  const ledgerRows = rawLedger.map(l=>({id:l.id,timestamp:number(l.timestamp),type:l.type,productId:l.product_id,quantityPieces:['LOAD_OUT','UNLOAD_OUT','SALE','ADJ_MINUS'].includes(l.type)?-l.quantity_pieces:l.quantity_pieces,locationId:l.location_id,referenceId:l.reference_id,workDayId:l.work_day_id}));
  const loads = (await c.query("SELECT response FROM api_operations WHERE actor_id=$1 AND operation='load' ORDER BY created_at",[user.id])).rows.map(x=>x.response);
  const accounting = (await c.query('SELECT * FROM accounting_ledger WHERE work_day_id=ANY($1::varchar[])',[ids])).rows.map(a=>({id:a.id,timestamp:number(a.timestamp),type:a.type,amountPaise:number(a.amount_paise),customerId:a.customer_id,invoiceId:a.invoice_id,workDayId:a.work_day_id}));
  const customers = (await c.query('SELECT * FROM customers ORDER BY name')).rows.map(customerDto);
  const taxRes = await c.query("SELECT data FROM app_settings WHERE id='tax'");
  const taxData = taxRes.rows[0]?.data || {cgst:0, sgst:0};
  const tax = { cgst: Number(taxData.cgst) || 0, sgst: Number(taxData.sgst) || 0 };
  return { products, workDays:days.map(d=>dayDto(d,invoices)),invoices,ledger:ledgerRows,loads,accounting,customers,outlets:customers.map(c=>({id:c.id,name:c.shopName || c.name,status:invoices.some(i=>i.customerId===c.id && i.workDayId===days[0]?.work_day_id && i.status==='VALID')?'Visited':'Pending'})), tax };
}

export function installOperations(app,pool) {
  const masterFields = {
    godowns:['name','location_name','active'], vehicles:['name','plate','godown_id','active'],
    products:['name','price_paise','units_per_strip','strips_per_box','pieces_per_box','active','sku','barcode','hsn','uom'],
    salesmen:['name','phone','active','status','location_name','vehicle_id','password_hash']
  };
  app.get('/api/v2/admin/:table(godowns|products|salesmen|vehicles)',endpoint(async req=>{
    const rows=(await pool.query(req.params.table === 'vehicles' ? 'SELECT v.*,g.location_name FROM vehicles v LEFT JOIN godowns g ON g.id=v.godown_id ORDER BY v.name' : `SELECT * FROM ${req.params.table} ORDER BY name`)).rows;
    return req.params.table==='salesmen'?rows.map(safeUser):rows;
  }));
  const saveMaster = endpoint(async req=>transaction(pool,async c=>{
    const table=req.params.table, data={...req.body}; delete data.id;
    if (req.method === 'PUT' && !(await c.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[req.params.id])).rows.length) throw new ApiError('Record not found.',404);
    if(table==='salesmen') {
      if ('mobile' in data) {data.phone=data.mobile;delete data.mobile;}
      if ('password_hash' in data) throw new ApiError('Password hashes cannot be submitted.');
      if(data.password) { if(typeof data.password!=='string'||data.password.length<8||data.password.length>256) throw new ApiError('Password must contain 8–256 characters.'); data.password_hash=hashPassword(data.password); }
      delete data.password;
      if(data.status) {if(!['ACTIVE','INACTIVE','ON_HOLD'].includes(data.status))throw new ApiError('Invalid status.');data.active=data.status==='ACTIVE';}
      if(data.phone && !/^\+?[0-9]{10,15}$/.test(data.phone))throw new ApiError('Enter a valid mobile number.');
    }
    if(Object.keys(data).some(k=>!masterFields[table].includes(k))) throw new ApiError('Unsupported field.');
    if('name' in data || req.method==='POST')data.name=text(data.name,'Name');
    for(const k of ['active'])if(k in data && typeof data[k]!=='boolean')throw new ApiError('Active must be true or false.');
    if(table==='products')for(const k of ['price_paise','units_per_strip','strips_per_box','pieces_per_box'])if(k in data)data[k]=integer(data[k],k,k==='price_paise'?0:1);
    if('godown_id' in data){data.godown_id=data.godown_id||null;if(data.godown_id)await activeGodown(c,data.godown_id);}
    if('vehicle_id' in data){data.vehicle_id=data.vehicle_id||null;if(data.vehicle_id && !(await c.query('SELECT id FROM vehicles WHERE id=$1 AND active=TRUE',[data.vehicle_id])).rows.length)throw new ApiError('Select an active vehicle.');}
    const id=req.params.id || uid(),keys=Object.keys(data),vals=Object.values(data);
    if(!keys.length)throw new ApiError('No fields supplied.');
    if(req.method==='PUT' && ['vehicles','salesmen'].includes(table)) {
      const column=table==='vehicles'?'vehicle_id':'salesman_id';
      if((await c.query(`SELECT 1 FROM work_days WHERE ${column}=$1 AND state<>'CLOSED'`,[id])).rows.length && ('vehicle_id' in data || 'godown_id' in data))throw new ApiError('Close the active work day before changing assignments.',409);
    }
    const sql=req.method==='POST'?`INSERT INTO ${table}(id,${keys.join(',')}) VALUES($${vals.length+1},${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`:`UPDATE ${table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${vals.length+1} RETURNING *`;
    const row=(await c.query(sql,[...vals,id])).rows[0];if(!row)throw new ApiError('Record not found.',404);
    await audit(c,req.method==='POST'?'CREATE_MASTER':'UPDATE_MASTER',id,{table,fields:keys.filter(k=>k!=='password_hash')});
    if (table === 'salesmen' && data.password_hash) await c.query('DELETE FROM auth_sessions WHERE user_id=$1',[id]);
    return table==='salesmen'?safeUser(row):row;
  }));
  app.post('/api/v2/admin/:table(godowns|products|salesmen|vehicles)',saveMaster);
  app.put('/api/v2/admin/:table(godowns|products|salesmen|vehicles)/:id',saveMaster);
  app.post('/api/v2/admin/salesmen/:id/:action(set-pin|reset-pin)',endpoint(async req=>transaction(pool,async c=>{
    const password=req.body?.pin || req.body?.password;
    if(typeof password!=='string'||password.length<8||password.length>256)throw new ApiError('Enter a new password with 8–256 characters.');
    const result=await c.query('UPDATE salesmen SET password_hash=$1 WHERE id=$2 RETURNING id',[hashPassword(password),req.params.id]);
    if(!result.rows.length)throw new ApiError('Salesman not found.',404);
    await c.query('DELETE FROM auth_sessions WHERE user_id=$1',[req.params.id]);
    await audit(c,'RESET_CREDENTIAL',req.params.id);return {success:true};
  })));
  app.get('/api/v2/admin/:location_type(godowns|vehicles)/:id/stock',endpoint(async req=>(await pool.query(`SELECT p.id AS product_id,p.name AS product_name,p.price_paise,p.pieces_per_box,p.strips_per_box,p.units_per_strip,(${sumSQL.replaceAll('type','l.type').replaceAll('quantity_pieces','l.quantity_pieces')})::integer AS quantity_pieces FROM products p LEFT JOIN stock_ledger l ON l.product_id=p.id AND l.location_id=$1 GROUP BY p.id ORDER BY p.name`,[req.params.id])).rows));
  app.get('/api/v2/admin/:location_type(godowns|vehicles)/:id/history',endpoint(async req=>{
    const params=[req.params.id]; const page=logPage(req.query,params,'l');
    return (await pool.query('SELECT l.*,p.name AS product_name FROM stock_ledger l JOIN products p ON p.id=l.product_id WHERE l.location_id=$1'+page.condition+page.suffix,params)).rows;
  }));
  app.get('/api/v2/admin/audit',endpoint(async req=>{
    const params=[]; const page=logPage(req.query,params);
    return (await pool.query('SELECT * FROM audit_log WHERE TRUE'+page.condition+page.suffix,params)).rows;
  }));

  app.get('/api/v2/admin/sales', endpoint(async req => {
    let dateFilter = '';
    const params = [];
    const qDate = req.query.date;
    const period = req.query.period;
    const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());

    if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) {
      dateFilter = 'calendar_date = $1';
      params.push(qDate);
    } else if (period === 'week') {
      dateFilter = "calendar_date >= ($1::date - interval '6 days') AND calendar_date <= $1";
      params.push(todayDateStr);
    } else if (period === 'month') {
      dateFilter = "calendar_date >= date_trunc('month', $1::date) AND calendar_date <= $1";
      params.push(todayDateStr);
    } else {
      dateFilter = 'calendar_date = $1';
      params.push(todayDateStr);
    }

    const { rows: stats } = await pool.query(
      `SELECT 
         COALESCE(SUM(total_amount_paise), 0) AS total_sales,
         COUNT(id) AS total_orders,
         COUNT(DISTINCT customer_id) AS unique_customers
       FROM invoices 
       WHERE status='VALID' AND ${dateFilter}`, params
    );

    const { rows: rawInvoices } = await pool.query(
      `SELECT id, invoice_number, created_at, customer_name, total_amount_paise, payment_mode, status
       FROM invoices 
       WHERE status='VALID' AND ${dateFilter} 
       ORDER BY created_at DESC`, params
    );

    const s = stats[0];
    const totalOrders = Number(s.total_orders);
    const totalSales = Number(s.total_sales);
    const uniqueCustomers = Number(s.unique_customers);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

    return {
      stats: { totalSales, totalOrders, uniqueCustomers, avgOrderValue },
      invoices: rawInvoices.map(i => ({...i, total_amount_paise: Number(i.total_amount_paise)}))
    };
  }));








  app.post('/api/v2/admin/stock/adjust',endpoint(req=>operation(pool,req,'adjust',async c=>{
    let {godown_id,product_id,quantity_pieces,kind,reason,unit,unit_quantity}=req.body;await activeGodown(c,godown_id);
    if(!['IN','OUT','ADJ_PLUS','ADJ_MINUS'].includes(kind))throw new ApiError('Invalid adjustment kind.');
    if (unit && unit !== 'PIECE') {
      const pData = (await c.query('SELECT strips_per_box, units_per_strip FROM products WHERE id=$1 FOR SHARE', [product_id])).rows[0];
      if (!pData) throw new ApiError('Product not found.');
      const q = integer(unit_quantity, 'Quantity', 1);
      if (unit === 'BOX') quantity_pieces = q * pData.strips_per_box * pData.units_per_strip;
      else if (unit === 'STRIP') quantity_pieces = q * pData.units_per_strip;
      else throw new ApiError('Invalid unit.');
    }
    const [i]=await productsFor(c,[{product_id,quantity_pieces}]);await lockStock(c,[godown_id],[product_id]);
    const minus=['OUT','ADJ_MINUS'].includes(kind),qty=await balance(c,godown_id,product_id);
    if(minus && qty<i.quantityPieces)throw new ApiError(`Insufficient inventory. Available quantity: ${qty}.`,409);
    const id=uid();await ledger(c,minus?'ADJ_MINUS':'ADJ_PLUS',product_id,i.quantityPieces,godown_id,id,null,text(reason,'Reason'));
    await audit(c,'STOCK_ADJUSTMENT',id,{godown_id,product_id,quantity_pieces: i.quantityPieces,kind});return {id,success:true};
  })));
  app.get('/api/v2/salesman/analytics',endpoint(async req=>{
    if(req.user.role!=='salesman')throw new ApiError('Salesman access required.',403);
    const end=req.query.to || dateString();
    const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
    if(!validDate(end))throw new ApiError('Choose a valid end date.');
    const start=req.query.from || new Date(Date.parse(end)-29*86400000).toISOString().slice(0,10);
    const period=req.query.period || 'day';
    if(!validDate(start) || start>end || (Date.parse(end)-Date.parse(start))/86400000>365)throw new ApiError('Choose a date range of at most 366 days.');
    if(!['day','week','month'].includes(period))throw new ApiError('Invalid chart interval.');
    const bucket=date=>{
      if(period==='month')return date.slice(0,7)+'-01';
      if(period==='week'){const d=new Date(date);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
      return date;
    };
    const series=new Map();
    for(let t=Date.parse(start);t<=Date.parse(end);t+=86400000){const key=bucket(new Date(t).toISOString().slice(0,10));series.set(key,{date:key,amountPaise:0,bills:0});}
    // Bounded aggregate only. A caller-supplied salesman ID is never used.
    const {rows}=await pool.query(`SELECT calendar_date,status,payment_mode,COUNT(*)::integer AS bills,COALESCE(SUM(total_amount_paise),0)::text AS amount
      FROM invoices WHERE salesman_id=$1 AND calendar_date BETWEEN $2::date AND $3::date
      GROUP BY calendar_date,status,payment_mode ORDER BY calendar_date`,[req.user.id,start,end]);
    const payments={CASH:0,UPI:0,CREDIT:0},statuses={VALID:0,VOID:0};
    let totalAmountPaise=0,totalBills=0;
    for(const row of rows){
      const bills=number(row.bills),amount=number(row.amount);
      if(row.status in statuses)statuses[row.status]+=bills;
      if(row.status!=='VALID')continue;
      const point=series.get(bucket(dateString(row.calendar_date)));
      if(point){point.amountPaise+=amount;point.bills+=bills;}
      if(row.payment_mode in payments)payments[row.payment_mode]+=amount;
      totalAmountPaise+=amount;totalBills+=bills;
    }
    if(!Number.isSafeInteger(totalAmountPaise))throw new ApiError('Sales total exceeds the supported reporting range.',422);
    return {from:start,to:end,period,series:[...series.values()],payments,statuses,totalAmountPaise,totalBills};
  }));
  app.get('/api/v2/salesman/snapshot',endpoint(req=>transaction(pool,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');return snapshot(c,req.user);}))); 
  app.post('/api/v2/salesman/work-days',endpoint(req=>operation(pool,req,'start-day',async c=>{
    const person=(await c.query('SELECT * FROM salesmen WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
    const vehicle=(await c.query('SELECT * FROM vehicles WHERE id=$1 AND active=TRUE FOR UPDATE',[person.vehicle_id])).rows[0];
    if(!vehicle?.godown_id)throw new ApiError('Ask your admin to assign an active vehicle and godown.');
    await activeGodown(c,vehicle.godown_id);
    const existing=(await c.query("SELECT * FROM work_days WHERE (salesman_id=$1 OR vehicle_id=$2) AND state<>'CLOSED'",[person.id,vehicle.id])).rows[0];
    if(existing){if(existing.salesman_id!==person.id)throw new ApiError('Vehicle has another active work day.',409);return {workDayId:existing.work_day_id};}
    const previous=(await c.query("SELECT * FROM work_days WHERE vehicle_id=$1 AND state='CLOSED' ORDER BY closed_at DESC LIMIT 1",[vehicle.id])).rows[0];
    const products=(await c.query('SELECT * FROM products ORDER BY id')).rows;
    await lockStock(c,[vehicle.id],products.map(p=>p.id));
    const opening={},prices={},heldDays={};for(const p of products){opening[p.id]=await balance(c,vehicle.id,p.id);prices[p.id]=number(p.price_paise);heldDays[p.id]=opening[p.id]>0?(previous?.metadata?.heldDays?.[p.id]||0)+1:0;}
    const id=uid(),now=Date.now();
    await c.query('INSERT INTO work_days(work_day_id,calendar_date,salesman_id,vehicle_id,godown_id,opened_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,dateString(),person.id,vehicle.id,vehicle.godown_id,now,{openingStockSnapshot:opening,pricesSnapshot:prices,heldDays,historicalStockLevels:previous?.metadata?.historicalStockLevels||{}}]);
    for(const p of products)await ledger(c,'HOLD_CARRY_FORWARD',p.id,opening[p.id],vehicle.id,id,id);
    return {workDayId:id};
  })));
  app.post('/api/v2/salesman/work-days/:id/state',endpoint(req=>operation(pool,req,'day-state:'+req.params.id,async c=>{
    const d=await ownDay(c,req.params.id,req.user),target=req.body.state;
    const transitions={NOT_STARTED:['LOADING','ON_ROUTE'],LOADING:['ON_ROUTE'],ON_ROUTE:['LOADING'],SENT_BACK:['ON_ROUTE','LOADING']};
    if(d.state!==target && !transitions[d.state]?.includes(target))throw new ApiError('Invalid work-day transition.',409);
    await c.query("UPDATE work_days SET state=$2::day_state,route_started_at=CASE WHEN $2::day_state='ON_ROUTE' THEN COALESCE(route_started_at,$3) ELSE route_started_at END WHERE work_day_id=$1",[d.work_day_id,target,Date.now()]);return {success:true};
  })));
  app.post('/api/v2/salesman/loads',endpoint(req=>operation(pool,req,'load',async () => {
    throw new ApiError('Direct stock loading without admin approval is disabled. Please submit a stock request.', 403);
  })));

  app.post('/api/v2/salesman/stock-requests',endpoint(req=>operation(pool,req,'stock-request',async c=>{
    const d=await ownDay(c,req.body.workDayId,req.user,['NOT_STARTED','LOADING','ON_ROUTE']);
    await activeGodown(c,d.godown_id);
    const items=await productsFor(c,req.body.items);
    const rawItems=Array.isArray(req.body.items)?req.body.items:[];
    const itemRecords=items.map(i=>{
      const raw=rawItems.find(r=>(r.productId||r.product_id)===i.productId);
      return {
        productId: i.productId,
        productName: i.product.name,
        quantityPieces: i.quantityPieces,
        unitsPerStrip: i.product.units_per_strip,
        piecesPerBox: i.product.pieces_per_box,
        boxes: raw?.boxes ?? 0,
        strips: raw?.strips ?? 0,
        pieces: raw?.pieces ?? 0
      };
    });
    const id=uid(), now=Date.now();
    await c.query(
      'INSERT INTO stock_requests(id,work_day_id,salesman_id,vehicle_id,godown_id,status,items,requested_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, d.work_day_id, d.salesman_id, d.vehicle_id, d.godown_id, 'PENDING', JSON.stringify(itemRecords), now]
    );
    await audit(c,'STOCK_REQUEST_CREATED',id,{workDayId:d.work_day_id,itemCount:itemRecords.length});
    return {id,status:'PENDING',requestedAt:now,workDayId:d.work_day_id,vehicleId:d.vehicle_id,godownId:d.godown_id,items:itemRecords};
  })));

  app.get('/api/v2/salesman/stock-requests',endpoint(async req=>{
    const { rows } = await pool.query(
      `SELECT sr.*, g.name AS godown_name, v.name AS vehicle_name 
       FROM stock_requests sr 
       LEFT JOIN godowns g ON g.id=sr.godown_id 
       LEFT JOIN vehicles v ON v.id=sr.vehicle_id 
       WHERE sr.salesman_id=$1 
       ORDER BY sr.requested_at DESC LIMIT 50`,
      [req.user.id]
    );
    return rows.map(r => ({
      id: r.id,
      workDayId: r.work_day_id,
      salesmanId: r.salesman_id,
      vehicleId: r.vehicle_id,
      vehicleName: r.vehicle_name,
      godownId: r.godown_id,
      godownName: r.godown_name,
      status: r.status,
      items: r.items,
      requestedAt: number(r.requested_at),
      processedAt: number(r.processed_at),
      adminNote: r.admin_note
    }));
  }));

  app.get('/api/v2/admin/stock-requests',endpoint(async () => {
    const { rows } = await pool.query(
      `SELECT sr.*, s.name AS salesman_name, v.name AS vehicle_name, g.name AS godown_name 
       FROM stock_requests sr 
       JOIN salesmen s ON s.id=sr.salesman_id 
       JOIN vehicles v ON v.id=sr.vehicle_id 
       JOIN godowns g ON g.id=sr.godown_id 
       ORDER BY sr.requested_at DESC LIMIT 200`
    );
    return rows.map(r => ({
      id: r.id,
      workDayId: r.work_day_id,
      salesmanId: r.salesman_id,
      salesmanName: r.salesman_name,
      vehicleId: r.vehicle_id,
      vehicleName: r.vehicle_name,
      godownId: r.godown_id,
      godownName: r.godown_name,
      status: r.status,
      items: r.items,
      requestedAt: number(r.requested_at),
      processedAt: number(r.processed_at),
      adminNote: r.admin_note
    }));
  }));

  app.post('/api/v2/admin/stock-requests/:id/approve',endpoint(req=>operation(pool,req,'approve-stock:'+req.params.id,async c=>{
    const reqRow = (await c.query('SELECT * FROM stock_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!reqRow) throw new ApiError('Stock request not found.', 404);
    if (reqRow.status === 'APPROVED') return { success: true, id: reqRow.id, status: 'APPROVED' };
    if (reqRow.status !== 'PENDING') throw new ApiError(`Request is already ${reqRow.status}.`, 409);

    const d = (await c.query('SELECT * FROM work_days WHERE work_day_id=$1 FOR UPDATE', [reqRow.work_day_id])).rows[0];
    if (!d || d.state === 'CLOSED') throw new ApiError('Associated workday is not active.', 409);
    await activeGodown(c, reqRow.godown_id);

    const items = reqRow.items;
    if (!Array.isArray(items) || !items.length) throw new ApiError('Stock request has no items.', 400);

    await lockStock(c, [reqRow.godown_id, reqRow.vehicle_id], items.map(i => i.productId));

    for (const i of items) {
      const qty = await balance(c, reqRow.godown_id, i.productId);
      if (qty < i.quantityPieces) {
        throw new ApiError(`Insufficient warehouse inventory for ${i.productName || i.productId}. Available: ${qty}, Requested: ${i.quantityPieces}.`, 409);
      }
    }

    const loadId = uid();
    for (const i of items) {
      await ledger(c, 'LOAD_OUT', i.productId, i.quantityPieces, reqRow.godown_id, loadId, reqRow.work_day_id);
      await ledger(c, 'LOAD_IN', i.productId, i.quantityPieces, reqRow.vehicle_id, loadId, reqRow.work_day_id);
    }

    const now = Date.now();
    await c.query('UPDATE stock_requests SET status=$1, processed_at=$2 WHERE id=$3', ['APPROVED', now, reqRow.id]);
    await audit(c, 'STOCK_REQUEST_APPROVED', reqRow.id, { loadId, workDayId: reqRow.work_day_id, vehicleId: reqRow.vehicle_id });
    return { success: true, id: reqRow.id, status: 'APPROVED' };
  })));

  app.post('/api/v2/admin/stock-requests/:id/reject',endpoint(req=>operation(pool,req,'reject-stock:'+req.params.id,async c=>{
    const reqRow = (await c.query('SELECT * FROM stock_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!reqRow) throw new ApiError('Stock request not found.', 404);
    if (reqRow.status === 'REJECTED') return { success: true, id: reqRow.id, status: 'REJECTED' };
    if (reqRow.status === 'APPROVED') throw new ApiError('Cannot reject an already approved request.', 409);
    if (reqRow.status !== 'PENDING') throw new ApiError(`Request is already ${reqRow.status}.`, 409);

    const note = req.body?.note ? text(req.body.note, 'Rejection note', false) : null;
    const now = Date.now();
    await c.query('UPDATE stock_requests SET status=$1, processed_at=$2, admin_note=$3 WHERE id=$4', ['REJECTED', now, note, reqRow.id]);
    await audit(c, 'STOCK_REQUEST_REJECTED', reqRow.id, { workDayId: reqRow.work_day_id, note });
    return { success: true, id: reqRow.id, status: 'REJECTED' };
  })));
  app.post('/api/v2/salesman/customers',endpoint(req=>operation(pool,req,'customer',async c=>{
    const b=req.body;const mobile=text(b.mobile,'Mobile');if(!/^\+?[0-9]{10,15}$/.test(mobile))throw new ApiError('Enter a valid mobile number.');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customer:'+mobile]);
    if((await c.query('SELECT id FROM customers WHERE mobile=$1',[mobile])).rows.length)throw new ApiError('A customer with this mobile already exists.',409);
    const id=typeof b.id==='string'&&b.id.length<=50?b.id:uid();
    await c.query('INSERT INTO customers(id,name,mobile,shop_name,area,credit_limit_paise) VALUES($1,$2,$3,$4,$5,$6)',[id,text(b.name,'Name'),mobile,b.shopName?text(b.shopName,'Shop'):null,b.area?text(b.area,'Area'):null,b.creditLimitPaise==null?null:integer(b.creditLimitPaise,'Credit limit')]);return {id};
  })));
  app.get('/api/v2/salesman/invoices/:id',endpoint(req=>transaction(pool,async c=>{
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const invoice=(await c.query('SELECT i.*,w.state AS work_day_state FROM invoices i JOIN work_days w ON w.work_day_id=i.work_day_id WHERE i.id=$1 AND i.salesman_id=$2',[req.params.id,req.user.id])).rows[0];
    if(!invoice)throw new ApiError('Invoice not found.',404);
    const items=(await c.query('SELECT * FROM sale_items WHERE invoice_id=$1 ORDER BY id',[invoice.id])).rows;
    return {...invoiceDto(invoice,items,req.user),workDayState:invoice.work_day_state};
  })));
  app.post('/api/v2/salesman/sales',endpoint(req=>operation(pool,req,'sale',async c=>{
    const b=req.body,d=await ownDay(c,b.workDayId,req.user,['ON_ROUTE']);
    if(!['CASH','UPI','CREDIT'].includes(b.paymentMode))throw new ApiError('Invalid payment mode.');
    const items=await productsFor(c,b.items);await lockStock(c,[d.vehicle_id],items.map(i=>i.productId));
    const balances = new Map((await c.query(`SELECT product_id, ${sumSQL} AS qty FROM stock_ledger WHERE location_id=$1 AND product_id=ANY($2::varchar[]) GROUP BY product_id`, [d.vehicle_id, items.map(i=>i.productId)])).rows.map(r=>[r.product_id,number(r.qty)]));
    let total=0;for(const i of items){const qty=balances.get(i.productId)||0;if(qty<i.quantityPieces)throw new ApiError(`Insufficient inventory. Available quantity: ${qty}.`,409);i.lineTotalPaise=integer(i.quantityPieces*number(i.product.price_paise),'Line amount',0,Number.MAX_SAFE_INTEGER);total+=i.lineTotalPaise;}
    integer(total,'Total',1,Number.MAX_SAFE_INTEGER);
    const taxRes = await c.query("SELECT data FROM app_settings WHERE id='tax'");
    const taxData = taxRes.rows[0]?.data || {cgst:0, sgst:0};
    const cgst_percent = Number(taxData.cgst) || 0;
    const sgst_percent = Number(taxData.sgst) || 0;
    const bill = calculateBill(total, taxData.cgst, taxData.sgst);
    const cgst_amount_paise = bill.cgstAmountPaise;
    const sgst_amount_paise = bill.sgstAmountPaise;
    const grand_total = bill.totalAmountPaise;

    if ((grand_total!==b.totalAmountPaise && bill.unroundedTotalPaise!==b.totalAmountPaise) || ['subtotalPaise','cgstAmountPaise','sgstAmountPaise'].some(key=>b[key]!==undefined && b[key]!==bill[key])) throw new ApiError('Product prices or tax rates changed. Refresh and review the sale.',409);
    if(b.paymentMode==='UPI')text(b.paymentRef,'UPI reference');
    let customer=null;if(b.customerId && b.customerId!=='walk-in'){customer=(await c.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE',[b.customerId])).rows[0];if(!customer)throw new ApiError('Customer not found.');}
    if(b.paymentMode==='CREDIT' && !customer)throw new ApiError('A customer is required for credit sales.');
    const before=number(customer?.outstanding_balance_paise),after=before+(b.paymentMode==='CREDIT'?grand_total:0);
    if(b.paymentMode==='CREDIT' && customer.credit_limit_paise!==null && after>number(customer.credit_limit_paise))throw new ApiError('Customer credit limit exceeded.',409);
    const id=uid(),timestamp=Date.now(),counter=d.invoice_counter+1,invoiceNumber=`${d.vehicle_id}-${dateString(d.calendar_date).replaceAll('-','')}-${id.slice(0,8)}`;
    
    await c.query('INSERT INTO invoices(id,invoice_number,created_at,calendar_date,work_day_id,salesman_id,vehicle_id,outlet_id,customer_id,customer_name,total_amount_paise,payment_mode,payment_ref,previous_balance_paise,new_balance_paise,cgst_percent,sgst_percent,cgst_amount_paise,sgst_amount_paise,subtotal_paise,round_off_paise) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)',[id,invoiceNumber,timestamp,d.calendar_date,d.work_day_id,d.salesman_id,d.vehicle_id,customer?.id||null,customer?.id||null,customer?.name||'Walk-in',grand_total,b.paymentMode,b.paymentRef||null,before,after,cgst_percent,sgst_percent,cgst_amount_paise,sgst_amount_paise,total,bill.roundOffPaise]);
    await c.query(`INSERT INTO sale_items(invoice_id,product_id,quantity_pieces,line_total_paise,product_snapshot) SELECT $1,x.product_id,x.quantity_pieces,x.line_total_paise,x.product_snapshot FROM jsonb_to_recordset($2::jsonb) AS x(product_id varchar,quantity_pieces integer,line_total_paise bigint,product_snapshot jsonb)`, [id,JSON.stringify(items.map(i=>({product_id:i.productId,quantity_pieces:i.quantityPieces,line_total_paise:i.lineTotalPaise,product_snapshot:productDto(i.product)})))]);
    await c.query(`INSERT INTO stock_ledger(id,timestamp,type,product_id,quantity_pieces,location_id,reference_id,work_day_id) SELECT x.id,$1,'SALE',x.product_id,x.quantity_pieces,$2,$3,$4 FROM jsonb_to_recordset($5::jsonb) AS x(id varchar,product_id varchar,quantity_pieces integer)`, [timestamp,d.vehicle_id,id,d.work_day_id,JSON.stringify(items.map(i=>({id:uid(),product_id:i.productId,quantity_pieces:i.quantityPieces})))]);
    await c.query('INSERT INTO accounting_ledger(id,timestamp,type,amount_paise,customer_id,invoice_id,work_day_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),timestamp,'SALES_'+b.paymentMode,grand_total,customer?.id||null,id,d.work_day_id]);
    if(b.paymentMode==='CREDIT')await c.query("INSERT INTO accounting_ledger(id,timestamp,type,amount_paise,customer_id,invoice_id,work_day_id) VALUES($1,$2,'CUSTOMER_RECEIVABLE',$3,$4,$5,$6)",[uid(),timestamp,grand_total,customer.id,id,d.work_day_id]);
    if(customer)await c.query('UPDATE customers SET outstanding_balance_paise=$2,last_sold_timestamp=$3 WHERE id=$1',[customer.id,after,timestamp]);
    await c.query('UPDATE work_days SET invoice_counter=$2 WHERE work_day_id=$1',[d.work_day_id,counter]);await audit(c,'SALE',id,{workDayId:d.work_day_id,total});return {id,invoiceNumber,...bill};
  })));
  app.post('/api/v2/salesman/invoices/:id/cancel',endpoint(req=>operation(pool,req,'cancel:'+req.params.id,async c=>{
    const invoice=(await c.query('SELECT * FROM invoices WHERE id=$1 AND salesman_id=$2',[req.params.id,req.user.id])).rows[0];if(!invoice)throw new ApiError('Invoice not found.',404);
    await ownDay(c,invoice.work_day_id,req.user,['ON_ROUTE','LOADING','SENT_BACK']);
    const i=(await c.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[invoice.id])).rows[0];if(i.status==='VOID')return {success:true};
    const items=(await c.query('SELECT * FROM sale_items WHERE invoice_id=$1',[i.id])).rows;await lockStock(c,[i.vehicle_id],items.map(x=>x.product_id));
    for(const x of items)await ledger(c,'SALE_CANCEL',x.product_id,x.quantity_pieces,i.vehicle_id,i.id,i.work_day_id);
    for(const type of ['REVERSAL_'+i.payment_mode,...(i.payment_mode==='CREDIT'?['REVERSAL_RECEIVABLE']:[])])await c.query('INSERT INTO accounting_ledger(id,timestamp,type,amount_paise,customer_id,invoice_id,work_day_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),Date.now(),type,i.total_amount_paise,i.customer_id,i.id,i.work_day_id]);
    if(i.payment_mode==='CREDIT')await c.query('UPDATE customers SET outstanding_balance_paise=outstanding_balance_paise-$2 WHERE id=$1',[i.customer_id,i.total_amount_paise]);
    await c.query("UPDATE invoices SET status='VOID' WHERE id=$1",[i.id]);await audit(c,'CANCEL_SALE',i.id);return {success:true};
  })));
  app.post('/api/v2/unload-requests',endpoint(req=>operation(pool,req,'unload',async c=>{
    if(req.user.role!=='salesman')throw new ApiError('Salesman access required.',403);
    const b=req.body,d=await ownDay(c,b.workDayId,req.user,['ON_ROUTE','SENT_BACK']);
    const products=(await c.query('SELECT * FROM products ORDER BY id')).rows;await lockStock(c,[d.vehicle_id],products.map(p=>p.id));
    const held=b.heldItems||{},unloaded=b.unloadedItems||{};
    if(Object.keys({...held,...unloaded}).some(id=>!products.some(p=>p.id===id)))throw new ApiError('Unknown product in unload.');
    const cash=integer(b.cashCollected,'Cash collected',0,Number.MAX_SAFE_INTEGER),breakdown=b.cashBreakdown||{};
    let counted=0;for(const [denom,count] of Object.entries(breakdown)){if(!['NOTE_500','NOTE_200','NOTE_100','NOTE_50','NOTE_20','NOTE_10','COIN_10','COIN_5','COIN_2','COIN_1'].includes(denom))throw new ApiError('Invalid cash denomination.');counted+=Number(denom.split('_')[1])*100*integer(count,'Denomination count',0,9999);}
    if(counted!==cash)throw new ApiError('Cash denomination total does not match cash collected.');
    const paymentTotals={cash:0,upi:0,credit:0,total:0};const billCounts={Cash:0,UPI:0,Credit:0};
    const bills=(await c.query("SELECT * FROM invoices WHERE work_day_id=$1 AND status='VALID'",[d.work_day_id])).rows;
    for(const i of bills){paymentTotals[i.payment_mode.toLowerCase()]+=number(i.total_amount_paise);paymentTotals.total+=number(i.total_amount_paise);billCounts[{CASH:'Cash',UPI:'UPI',CREDIT:'Credit'}[i.payment_mode]]++;}
    if(cash!==paymentTotals.cash)throw new ApiError('Cash collected must equal cash sales.');
    const rows=[];for(const p of products){const qty=await balance(c,d.vehicle_id,p.id),hold=integer(held[p.id]??0,'Held quantity'),unload=integer(unloaded[p.id]??0,'Unloaded quantity');if(hold+unload!==qty)throw new ApiError(`Reconcile all remaining stock for ${p.name}. Expected ${qty}.`,409);
      const movement=(await c.query("SELECT COALESCE(SUM(quantity_pieces),0) AS qty FROM stock_ledger WHERE work_day_id=$1 AND location_id=$2 AND product_id=$3 AND type='LOAD_IN'",[d.work_day_id,d.vehicle_id,p.id])).rows[0];
      const opening=d.metadata.openingStockSnapshot?.[p.id]||0,loaded=number(movement.qty),sold=opening+loaded-qty;
      rows.push({productId:p.id,productName:p.name,product:productDto(p),opening,loadedAtStart:loaded,topUp:0,totalAvailable:opening+loaded,sold,expectedRemaining:qty,countedRemaining:qty,difference:0,holdQty:hold,unloadQty:unload,startFromHeldPieces:opening,startLoadedPieces:loaded,soldPieces:sold,remainingToGodownPieces:unload,remainingHeldInVehiclePieces:hold,salesPaise:0,soldAmountPaise:0,priceSnapshotPaise:d.metadata.pricesSnapshot?.[p.id]??number(p.price_paise),timeline:[]});
    }
    const itemTotals=(await c.query("SELECT s.product_id,SUM(s.line_total_paise) AS total FROM sale_items s JOIN invoices i ON i.id=s.invoice_id WHERE i.work_day_id=$1 AND i.status='VALID' GROUP BY s.product_id",[d.work_day_id])).rows;
    for(const row of rows){row.salesPaise=number(itemTotals.find(x=>x.product_id===row.productId)?.total);row.soldAmountPaise=row.salesPaise;row.salesRs=row.salesPaise/100;row.cancelledBillsCount=0;}
    const data={workDayId:d.work_day_id,salesmanId:d.salesman_id,vehicleId:d.vehicle_id,calendarDate:dateString(d.calendar_date),paymentTotals,billCounts,cashCollected:cash,cashDenominationBreakdown:breakdown,products:rows};
    await c.query("UPDATE work_days SET state='UNLOAD_REQUESTED',cash_collected_paise=$2,request_data=$3,requested_at=$4,metadata=metadata||$5::jsonb WHERE work_day_id=$1",[d.work_day_id,cash,data,Date.now(),JSON.stringify({heldItems:held,unloadedItems:unloaded,cashBreakdown:breakdown,cashTotalPaise:cash,noteCount:b.noteCount,coinCount:b.coinCount,dayStockReportSnapshot:Object.fromEntries(rows.map(r=>[r.productId,r]))})]);
    await audit(c,'UNLOAD_REQUESTED',d.work_day_id);return {success:true};
  })));
  app.get('/api/v2/unload-requests',endpoint(async()=> (await pool.query('SELECT * FROM work_days WHERE request_data IS NOT NULL ORDER BY requested_at DESC LIMIT 200')).rows.map(d=>({id:d.work_day_id,status:d.state==='CLOSED'?'APPROVED':d.state==='UNLOAD_REQUESTED'?'PENDING':d.state,requestedAt:number(d.requested_at),request_data:d.request_data}))));
  app.get('/api/v2/unload-requests/:id',endpoint(req=>transaction(pool,async c=>{const d=await ownDay(c,req.params.id,req.user);return {status:d.state==='CLOSED'?'APPROVED':d.state,adminNote:d.admin_note};})));
  app.post('/api/v2/unload-requests/:id/send-back',endpoint(req=>operation(pool,req,'send-back:'+req.params.id,async c=>{
    const d=await ownDay(c,req.params.id,req.user,['UNLOAD_REQUESTED']);const note=text(req.body.note,'Correction note');await c.query("UPDATE work_days SET state='SENT_BACK',admin_note=$2 WHERE work_day_id=$1",[d.work_day_id,note]);await audit(c,'UNLOAD_SENT_BACK',d.work_day_id,{note});return {success:true};
  })));
  app.post('/api/v2/unload-requests/:id/approve',endpoint(req=>operation(pool,req,'approve:'+req.params.id,async c=>{
    const d=await ownDay(c,req.params.id,req.user,['UNLOAD_REQUESTED','CLOSED']);if(d.state==='CLOSED')return {success:true};
    const {heldItems:held={},unloadedItems:unloaded={}}=d.metadata;const ids=[...new Set([...Object.keys(held),...Object.keys(unloaded)])];await lockStock(c,[d.vehicle_id,d.godown_id],ids);
    const cash=number((await c.query("SELECT COALESCE(SUM(total_amount_paise),0) AS cash FROM invoices WHERE work_day_id=$1 AND status='VALID' AND payment_mode='CASH'",[d.work_day_id])).rows[0].cash);
    if(cash!==number(d.cash_collected_paise))throw new ApiError('Cash reconciliation changed. Send this report back.',409);
    for(const id of ids){const qty=await balance(c,d.vehicle_id,id);if(number(held[id])+number(unloaded[id])!==qty)throw new ApiError('Stock changed. Send this report back.',409);await ledger(c,'UNLOAD_OUT',id,number(unloaded[id]),d.vehicle_id,d.work_day_id,d.work_day_id);await ledger(c,'UNLOAD_IN',id,number(unloaded[id]),d.godown_id,d.work_day_id,d.work_day_id);}
    const history={...d.metadata.historicalStockLevels};for(const r of d.request_data.products)history[r.productId]=[...(history[r.productId]||[]),r.totalAvailable].slice(-7);
    await c.query("UPDATE work_days SET state='CLOSED',closed_at=$2,admin_note='Job cleared',metadata=metadata||$3::jsonb WHERE work_day_id=$1",[d.work_day_id,Date.now(),JSON.stringify({historicalStockLevels:history})]);await audit(c,'UNLOAD_APPROVED',d.work_day_id);return {success:true};
  })));
  app.get("/api/v2/settings/tax", endpoint(async req => (await pool.query("SELECT data FROM app_settings WHERE id=$1", ["tax"])).rows[0]?.data || {cgst:0, sgst:0}));
  app.get("/api/v2/admin/settings/tax", endpoint(async req => (await pool.query("SELECT data FROM app_settings WHERE id=$1", ["tax"])).rows[0]?.data || {cgst:0, sgst:0}));
  app.put("/api/v2/admin/settings/tax", endpoint(async req => {
    const {cgst, sgst} = req.body;
    await pool.query("UPDATE app_settings SET data=jsonb_build_object('cgst', $1::numeric, 'sgst', $2::numeric) WHERE id=$3", [cgst, sgst, "tax"]);
    return {success:true};
  }));
}
