import { useEffect, useState } from 'react';
import { getSalesAnalytics, SalesAnalyticsData } from '../data/realApi';
import { formatRupees } from '../domain/money';

const colors = ['#2563eb', '#16a34a', '#d97706'];
const card = 'ui-card bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700';
export function pieSegments(values: number[]) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  let offset = 0;
  return values.map(value => { const fraction = total ? Math.max(0, value) / total : 0; const result = { fraction, offset }; offset += fraction; return result; });
}
function Distribution({ title, labels, values, doughnut = false }: { title: string; labels: string[]; values: number[]; doughnut?: boolean }) {
  const total = values.reduce((s, v) => s + v, 0);
  const segments = pieSegments(values);
  return <section className={card}><h4 className="font-semibold">{title}</h4>
    {!total ? <p className="py-8 text-sm text-gray-500">No records for this date range.</p> : <>
      <svg viewBox="0 0 200 200" className="w-40 h-40 mx-auto my-3" role="img" aria-label={title}>
        {segments.map(({ fraction, offset }, i) => {
          if (!fraction) return null;
          const a = offset * Math.PI * 2 - Math.PI / 2, b = (offset + fraction) * Math.PI * 2 - Math.PI / 2;
          const label = `${labels[i]}: ${doughnut ? formatRupees(values[i]) : values[i]} (${(fraction * 100).toFixed(1)}%)`;
          if (fraction === 1) return <circle key={labels[i]} cx="100" cy="100" r="85" fill={colors[i]}><title>{label}</title></circle>;
          return <path key={labels[i]} fill={colors[i]} d={`M100,100 L${100+85*Math.cos(a)},${100+85*Math.sin(a)} A85,85 0 ${fraction>.5?1:0},1 ${100+85*Math.cos(b)},${100+85*Math.sin(b)} Z`}><title>{label}</title></path>;
        })}
        {doughnut && <circle cx="100" cy="100" r="52" className="fill-white dark:fill-gray-800" />}
      </svg>
      <ul className="space-y-2 text-sm">{labels.map((label, i) => <li key={label} className="flex justify-between gap-2"><span><span aria-hidden="true" className="inline-block w-3 h-3 mr-2 rounded" style={{background:colors[i]}} />{label}</span><span>{doughnut ? formatRupees(values[i]) : values[i]} · {(segments[i].fraction*100).toFixed(1)}%</span></li>)}</ul>
    </>}
  </section>;
}
export default function SalesAnalytics() {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [from, setFrom] = useState(() => new Date(Date.parse(today)-29*86400000).toISOString().slice(0,10));
  const [to, setTo] = useState(today);
  const [period, setPeriod] = useState('day');
  const [data, setData] = useState<SalesAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    getSalesAnalytics(from,to,period).then(result => { if(active)setData(result); }).catch(e => {if(active)setError(e.message || 'Could not load sales analytics.');}).finally(()=>{if(active)setLoading(false);});
    return () => {active=false;};
  },[from,to,period,revision]);
  return <section className="space-y-3" aria-label="Sales analytics">
    <h3 className="font-bold text-lg">Sales analytics</h3>
    <p className="text-xs text-gray-500">Your recorded business dates. Sales amounts exclude cancelled bills; credit is sales, not cash received.</p>
    <div className="flex flex-wrap gap-3 text-sm">
      <label>From<input aria-label="Analytics from" type="date" value={from} onChange={e=>setFrom(e.target.value)} className="block border rounded p-2 bg-transparent max-w-full" /></label>
      <label>To<input aria-label="Analytics to" type="date" value={to} onChange={e=>setTo(e.target.value)} className="block border rounded p-2 bg-transparent max-w-full" /></label>
      <label>Interval<select value={period} onChange={e=>setPeriod(e.target.value)} className="block border rounded p-2 bg-transparent"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
      <button onClick={()=>setRevision(n=>n+1)} disabled={loading} className="text-blue-600">Refresh charts</button>
    </div>
    {loading ? <p role="status">Loading sales analytics...</p> : error ? <p role="alert" className="text-red-600">{error}</p> : data && <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Distribution title="Bill status counts" labels={['Valid','Cancelled']} values={[data.statuses.VALID,data.statuses.VOID]} />
      </div>
    </>}
  </section>;
}
