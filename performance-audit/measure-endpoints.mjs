// Read-only, sequential sampling. Run separately for each role with a test token.
// API_BASE_URL=https://staging.example/api/v2 API_TOKEN=... AUDIT_ROLE=admin node performance-audit/measure-endpoints.mjs
import fs from 'node:fs';
const base=process.env.API_BASE_URL;
const token=process.env.API_TOKEN;
const role=process.env.AUDIT_ROLE;
if(!base || !token || !['admin','salesman'].includes(role)) throw Error('Set API_BASE_URL, API_TOKEN and AUDIT_ROLE (admin or salesman).');
const count=Number(process.env.SAMPLES || 100);
if(!Number.isInteger(count)||count<1||count>1000) throw Error('SAMPLES must be 1–1000.');
const routes=role==='admin'?['/session','/admin/products','/admin/sales?period=month','/admin/stock-requests','/unload-requests']:['/session','/salesman/snapshot','/salesman/stock-requests','/settings/tax'];
const results=[];
const percentile=(a,p)=>a[Math.max(0,Math.ceil(a.length*p)-1)];
for(const route of routes){
  const samples=[];
  for(let i=0;i<count;i++){
    const start=performance.now();
    const response=await fetch(base.replace(/\/$/,'')+route,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    const headersMs=performance.now()-start;
    const body=await response.arrayBuffer();
    if(!response.ok)throw Error(`Aborted: ${route} returned ${response.status}; error responses are not success latency samples.`);
    samples.push({ttfbMs:headersMs,totalMs:performance.now()-start,decodedBytes:body.byteLength});
    await new Promise(r=>setTimeout(r,1000));
  }
  const values=samples.map(s=>s.totalMs).sort((a,b)=>a-b);
  results.push({route,count,meanMs:values.reduce((a,b)=>a+b,0)/count,p95Ms:percentile(values,.95),p99Ms:percentile(values,.99),samples});
}
const output={capturedAt:new Date().toISOString(),role,notes:'Client-observed serial latency including network, not server handler time or a load test. p99 needs larger production samples.',results};
fs.writeFileSync(new URL(`./evidence/endpoint-${role}.json`,import.meta.url),JSON.stringify(output,null,2));
console.table(results.map(({samples,...rest})=>rest));
