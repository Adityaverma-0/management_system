import { useMemo, useState } from 'react';
import { Invoice, WorkDay } from '../../domain/types';
import { formatRupees } from '../../domain/money';
import HistoryDayDetail from './HistoryDayDetail';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function DayWiseView({ invoices, workDays }: { invoices: Invoice[], workDays: WorkDay[] }) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const toggle = (date: string) => {
    const next = new Set(expandedDates);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    setExpandedDates(next);
  };

  const data = useMemo(() => {
    const map = new Map<string, {
      date: string;
      totalSales: number;
      billsCount: number;
      days: WorkDay[];
      monthLabel: string;
    }>();

    for (const inv of invoices) {
      if (inv.status !== 'VALID') continue;
      const d = map.get(inv.calendarDate) || {
        date: inv.calendarDate,
        totalSales: 0,
        billsCount: 0,
        days: [],
        monthLabel: new Date(inv.calendarDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      };
      d.billsCount++;
      d.totalSales += inv.totalAmountPaise;
      map.set(inv.calendarDate, d);
    }

    for (const wd of workDays) {
      if (map.has(wd.calendarDate)) {
        const entry = map.get(wd.calendarDate)!;
        if (!entry.days.find(d => d.workDayId === wd.workDayId)) {
          entry.days.push(wd);
        }
      }
    }

    const sorted = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
    
    // Group by month
    const byMonth: { month: string, items: typeof sorted }[] = [];
    let currentMonth = '';
    let currentGroup: typeof sorted = [];
    
    for (const item of sorted) {
      if (item.monthLabel !== currentMonth) {
        if (currentGroup.length > 0) {
          byMonth.push({ month: currentMonth, items: currentGroup });
        }
        currentMonth = item.monthLabel;
        currentGroup = [item];
      } else {
        currentGroup.push(item);
      }
    }
    if (currentGroup.length > 0) {
      byMonth.push({ month: currentMonth, items: currentGroup });
    }

    return byMonth;
  }, [invoices, workDays]);

  return (
    <div className="space-y-6">
      {data.map(group => (
        <div key={group.month}>
          <h3 className="font-bold text-gray-500 text-sm mb-3 ml-1 uppercase tracking-wider">{group.month}</h3>
          <div className="space-y-3">
            {group.items.map(d => {
              const isExpanded = expandedDates.has(d.date);
              
              // Find max state
              const stateSet = new Set(d.days.map(x => x.state));
              let statusBadge = '';
              if (stateSet.has('CLOSED')) statusBadge = 'Closed';
              else if (stateSet.has('APPROVED')) statusBadge = 'Approved';
              else if (stateSet.has('SENT_BACK')) statusBadge = 'Sent back';
              else if (stateSet.has('UNLOAD_REQUESTED')) statusBadge = 'Waiting';
              else statusBadge = 'Open';

              return (
                <div key={d.date} className="ui-card bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                  <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} aria-expanded={isExpanded} onClick={() => toggle(d.date)} className="p-4 flex flex-wrap gap-3 justify-between items-center cursor-pointer active:bg-gray-50 dark:active:bg-gray-900 transition-colors">
                    <div>
                      <h4 className="font-bold flex flex-wrap gap-2 items-center">
                        {new Date(d.date).toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short' })}
                        <span className={`shrink-0 whitespace-nowrap text-xs px-1.5 py-0.5 rounded font-bold ${statusBadge === 'Closed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {statusBadge}
                        </span>
                      </h4>
                      <p className="text-xs font-bold text-gray-500 mt-1">{d.billsCount} Bills {d.days.length > 1 ? ` • ${d.days.length} shifts` : ''}</p>
                    </div>
                    <div className="text-right flex items-center">
                      <p className="font-bold text-blue-600 mr-2 whitespace-nowrap">{formatRupees(d.totalSales)}</p>
                      {isExpanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                      {d.days.map(wd => (
                        <HistoryDayDetail key={wd.workDayId} day={wd} invoices={invoices} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
