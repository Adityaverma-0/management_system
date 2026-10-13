import { useState, useEffect, useCallback, useMemo } from 'react';
import { DENOMINATIONS, calculateBreakdownTotal, validateBreakdownCount } from '../domain/cashDenominations';
import { formatRupees } from '../domain/money';
import { Minus, Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface CashCounterProps {
  expectedCashPaise: number;
  initialBreakdown?: Record<string, number>;
  onChange: (breakdown: Record<string, number>, totalPaise: number, noteCount: number, coinCount: number) => void;
}

export default function CashCounter({ expectedCashPaise, initialBreakdown, onChange }: CashCounterProps) {
  const [breakdown, setBreakdown] = useState<Record<string, number>>(initialBreakdown || {});
  const [isCollapsed, setIsCollapsed] = useState(expectedCashPaise === 0);

  // Initialize from initialBreakdown on mount if provided
  useEffect(() => {
    if (initialBreakdown) {
      setBreakdown(initialBreakdown);
    }
  }, [initialBreakdown]);

  const updateCount = useCallback((key: string, valueStr: string | number, delta?: number) => {
    setBreakdown(prev => {
      const current = prev[key] || 0;
      let nextVal = current;

      if (delta !== undefined) {
        nextVal = current + delta;
      } else {
        const parsed = parseInt(valueStr as string, 10);
        nextVal = isNaN(parsed) ? 0 : parsed;
      }

      if (!validateBreakdownCount(nextVal)) {
        return prev;
      }

      const updated = { ...prev, [key]: nextVal };
      
      const { totalPaise, noteCount, coinCount } = calculateBreakdownTotal(updated);
      onChange(updated, totalPaise, noteCount, coinCount);
      
      return updated;
    });
  }, [onChange]);

  const handleReset = () => {
    if (confirm('Reset all cash counts?')) {
      const empty: Record<string, number> = {};
      setBreakdown(empty);
      onChange(empty, 0, 0, 0);
    }
  };

  const { totalPaise, noteCount, coinCount } = useMemo(() => calculateBreakdownTotal(breakdown), [breakdown]);

  if (expectedCashPaise === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 rounded-xl text-center text-gray-500 font-medium">
        No cash sales today.
      </div>
    );
  }

  const notes = DENOMINATIONS.filter(d => d.type === 'NOTE');
  const coins = DENOMINATIONS.filter(d => d.type === 'COIN');

  const renderRow = (d: typeof DENOMINATIONS[0]) => {
    const count = breakdown[d.key] || 0;
    const rowAmount = count * d.valueRupees;
    return (
      <div key={d.key} className="ui-cash-row flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
        <div className="w-1/3 font-bold text-gray-700 dark:text-gray-300 text-sm">
          {d.label}
        </div>
        <div className="ui-stepper flex items-center space-x-2 w-1/3 justify-center">
          <button 
            aria-label={`Decrease ${d.label} count`} onClick={() => updateCount(d.key, '', -1)}
            className="w-8 h-8 flex justify-center items-center bg-gray-100 dark:bg-gray-800 rounded-full active:opacity-90"
          >
            <Minus size={16}/>
          </button>
          <input 
            type="number"
            inputMode="numeric" aria-label={`${d.label} count`}
            value={count === 0 ? '' : count}
            onChange={e => updateCount(d.key, e.target.value)}
            className="w-14 text-center font-bold text-lg bg-transparent border-b-2 border-gray-200 dark:border-gray-700 focus:border-blue-500 outline-none"
            placeholder="0"
          />
          <button 
            aria-label={`Increase ${d.label} count`} onClick={() => updateCount(d.key, '', 1)}
            className="w-8 h-8 flex justify-center items-center bg-gray-100 dark:bg-gray-800 rounded-full active:opacity-90"
          >
            <Plus size={16}/>
          </button>
        </div>
        <div className="w-1/3 text-right font-bold text-gray-800 dark:text-gray-200">
          ₹ {rowAmount}
        </div>
      </div>
    );
  };

  return (
    <div className="ui-card bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mt-4">
      <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }}
        className="p-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center cursor-pointer"
        aria-expanded={!isCollapsed} onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h3 className="text-lg font-bold">Count your cash</h3>
        {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
      </div>

      {!isCollapsed && (
        <>
          <div className="p-4 space-y-6">
            <div>
              <h4 className="text-sm font-bold text-green-700 dark:text-green-500 uppercase tracking-wider mb-2 border-b border-green-200 dark:border-green-900/30 pb-1">Notes</h4>
              <div className="space-y-1">
                {notes.map(renderRow)}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-amber-700 dark:text-amber-500 uppercase tracking-wider mb-2 border-b border-amber-200 dark:border-amber-900/30 pb-1">Coins</h4>
              <div className="space-y-1">
                {coins.map(renderRow)}
              </div>
            </div>
            
            <div className="flex justify-end">
              <button onClick={handleReset} className="text-red-500 text-sm font-bold flex items-center px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <RefreshCw size={14} className="mr-1" /> Reset all
              </button>
            </div>
          </div>

          <div className="bg-gray-100 dark:bg-gray-900 p-4 border-t border-gray-200 dark:border-gray-700  flex justify-between items-center">
            <div className="text-xs text-gray-500 font-medium space-y-1">
              <div>Total Notes: <span className="font-bold text-gray-800 dark:text-gray-200">{noteCount}</span></div>
              <div>Total Coins: <span className="font-bold text-gray-800 dark:text-gray-200">{coinCount}</span></div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 uppercase font-bold">Counter Total</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatRupees(totalPaise)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
