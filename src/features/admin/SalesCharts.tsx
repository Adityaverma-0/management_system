import { formatRupees } from '../../domain/money';

export interface SalesChartData {
  series: { date: string; amountPaise: number; bills: number }[];
  payments: { CASH: number; UPI: number; CREDIT: number };
  totalAmountPaise: number; totalBills: number;
}
const colors = ['#2563eb', '#16a34a', '#d97706'];
const card = 'ui-card bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700';
export function linePoints(values: number[]) {
  const max = Math.max(1, ...values);
  return values.map((value, i) => ({ x: values.length === 1 ? 300 : 45 + i * 510 / Math.max(1, values.length - 1), y: 165 - value * 135 / max }));
}
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
      <ul className="space-y-2 text-sm">{labels.map((label, i) => <li key={label} className="flex flex-wrap justify-between gap-2"><span><span aria-hidden="true" className="inline-block w-3 h-3 mr-2 rounded" style={{background:colors[i]}} />{label}</span><span>{doughnut ? formatRupees(values[i]) : values[i]} · {(segments[i].fraction*100).toFixed(1)}%</span></li>)}</ul>
    </>}
  </section>;
}
export default function SalesCharts({ data }: { data: SalesChartData }) {
  const points = linePoints(data.series.map(row => row.amountPaise));
  return <section aria-label="Sales charts" className="space-y-3">
      <section className={card}><h4 className="font-semibold">Sales trend</h4><p className="text-sm">{formatRupees(data.totalAmountPaise)} · {data.totalBills} valid bills</p>
        {!data.totalBills ? <p className="py-8 text-sm text-gray-500">No completed sales for this date range.</p> : <>
          <p className="text-sm mt-3">Peak {formatRupees(Math.max(...data.series.map(row => row.amountPaise)))}</p>
          <svg viewBox="0 0 600 180" className="ui-chart w-full" role="img" aria-label="Sales amount trend in rupees">
            <line x1="45" y1="165" x2="555" y2="165" stroke="currentColor" opacity=".3" />

            <polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="3" />
            {points.map((point,i)=><circle key={data.series[i].date} cx={point.x} cy={point.y} r="3" fill="#2563eb"><title>{data.series[i].date}: {formatRupees(data.series[i].amountPaise)}, {data.series[i].bills} bills</title></circle>)}

          </svg>
          <div className="flex justify-between gap-2 text-xs mb-3"><span>{data.series[0]?.date}</span><span>{data.series[data.series.length-1]?.date}</span></div>
          <details className="text-sm"><summary className="cursor-pointer">View amounts and bill counts</summary><div className="max-h-60 overflow-auto"><table className="w-full text-left"><thead><tr><th>Period starting</th><th>Sales</th><th>Bills</th></tr></thead><tbody>{data.series.map(row=><tr key={row.date}><td>{row.date}</td><td>{formatRupees(row.amountPaise)}</td><td>{row.bills}</td></tr>)}</tbody></table></div></details>
        </>}
      </section>
    <Distribution title="Sales by payment method" labels={['Cash','UPI','Credit']} values={[data.payments.CASH,data.payments.UPI,data.payments.CREDIT]} doughnut />
  </section>;
}
