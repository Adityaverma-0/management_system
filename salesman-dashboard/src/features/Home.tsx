import SalesAnalytics from './SalesAnalytics';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchActiveWorkDay, updateDayState, devResetDay, getAccountingEntries, getLedger } from '../data/mockApi';
import { WorkDay, DayState } from '../domain/types';
import { canTransition } from '../domain/dayState';
import { calculateAccountingTotals } from '../domain/accounting';
import { formatRupees } from '../domain/money';
import { calculateVehicleStockSummary, getLowStockSuggestions, calculateRemainingStock } from '../domain/stockLedger';
import { PRODUCTS } from '../data/catalog';
import { ShoppingCart, Banknote, QrCode, CreditCard, AlertTriangle, Calculator } from 'lucide-react';

const STATE_LABELS: Record<DayState, string> = {
  NOT_STARTED: 'Not Started',
  LOADING: 'Loading',
  ON_ROUTE: 'On Route',
  UNLOAD_REQUESTED: 'Awaiting Admin',
  SENT_BACK: 'Fix Unload',
  APPROVED: 'Approved',
  CLOSED: 'Closed'
};

const STATE_ORDER: DayState[] = [
  'NOT_STARTED', 'LOADING', 'ON_ROUTE', 'UNLOAD_REQUESTED', 'APPROVED', 'CLOSED'
];

export default function Home() {
  const [summary, setSummary] = useState<WorkDay | null>(null);
  const [accounts, setAccounts] = useState({ cash: 0, upi: 0, credit: 0, total: 0 });
  const [error, setError] = useState('');
  const [lowStockCount, setLowStockCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      const s = await fetchActiveWorkDay();
      setSummary(s);
      
      // Accounts
      const acc = await getAccountingEntries();
      const todayAcc = acc.filter(a => a.workDayId === s.workDayId);
      setAccounts(calculateAccountingTotals(todayAcc));
      
      // Low Stock Check
      const ledger = await getLedger();
      const vehicleStock = calculateVehicleStockSummary(ledger, s.vehicleId, s.workDayId, s.openingStockSnapshot);
      const warehouseFn = (id: string) => calculateRemainingStock(ledger, id, s.warehouseId);
      const suggs = getLowStockSuggestions(vehicleStock, s.historicalStockLevels || {}, PRODUCTS, warehouseFn);
      setLowStockCount(suggs.length);
    };
    const refresh = () => { void load().catch(e => setError(e.message)); };
    refresh();
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

  if (error) return <div role="alert" className="p-4">{error}<button onClick={() => window.location.reload()}>Retry</button></div>;
  if (!summary) return <div className="p-4">Loading...</div>;

  const handleNextState = async (next: DayState) => {
    if (canTransition(summary.state, next)) {
      try { await updateDayState(summary.workDayId, next); setSummary({ ...summary, state: next }); }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not change day state.'); }
    }
  };

  const action = (() => { // Removed getPrimaryAction function to keep everything in Home component scope or make just const
    switch (summary.state) {
      case 'NOT_STARTED': {
        const hasStock = Object.values(summary.openingStockSnapshot).some(v => v > 0);
        if (hasStock) {
          return { label: 'Start Route (with Held Stock)', action: () => handleNextState('ON_ROUTE') };
        }
        return { label: 'Start Day (Load Stock)', action: () => {
          handleNextState('LOADING').then(() => navigate('/load-stock'));
        }};
      }
      case 'LOADING': 
        return { label: 'Confirm Loaded & Start Route', action: () => handleNextState('ON_ROUTE') };
      case 'ON_ROUTE': 
        return { label: 'End Day (Unload)', action: () => navigate('/unload') };
      case 'SENT_BACK':
        return { label: 'Fix Unload Request', action: () => navigate('/unload') };
      case 'UNLOAD_REQUESTED':
      case 'APPROVED': 
        return null;
      case 'CLOSED':
        return { label: 'Start New Day', action: async () => {
          if (confirm('Start a new work day?')) {
            await devResetDay();
            const fresh = await fetchActiveWorkDay();
            setSummary(fresh);
            setAccounts({ cash: 0, upi: 0, credit: 0, total: 0 });
          }
        }};
    }
  })();
  
  const visualState = summary.state === 'SENT_BACK' ? 'UNLOAD_REQUESTED' : summary.state;
  const currentIndex = STATE_ORDER.indexOf(visualState);

  const heldStockItems = Object.entries(summary.openingStockSnapshot).filter(([_, qty]) => qty > 0);
  const hasHeldStock = heldStockItems.length > 0;

  return (
    <div className="space-y-6 flex flex-col">
      <div className="space-y-6">
        <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-wrap gap-4 justify-between items-center">
          <div>
            <h2 className="text-xl font-bold mb-1">Welcome, {summary.salesmanName || summary.salesmanId}</h2>
            <p className="text-sm text-gray-500">{summary.vehicleName || summary.vehicleId}</p>
          </div>
          <div className="flex flex-col gap-2">
          <button 
            onClick={() => navigate('/load-stock')}
            className="text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg text-sm"
          >
            Top-up Stock
          </button>
          <button 
            onClick={() => navigate('/stock-requests')}
            className="text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg text-sm"
          >
            My Requests
          </button>
          </div>
        </div>

        {hasHeldStock && summary.state === 'NOT_STARTED' && (
          <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-4 rounded-xl font-medium border border-amber-200 dark:border-amber-800/30">
            <div className="font-bold mb-1">Carried from yesterday</div>
            <div className="text-sm">You have {heldStockItems.length} products held overnight. You can start your route directly.</div>
          </div>
        )}

        <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-x-auto">
          <div className="flex items-center min-w-max space-x-2">
            {STATE_ORDER.map((state, i) => {
              const isPast = i < currentIndex;
              const isCurrent = i === currentIndex;
              const isSentBack = state === 'UNLOAD_REQUESTED' && summary.state === 'SENT_BACK';
              
              return (
                <div key={state} className="flex items-center">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold
                    ${isSentBack ? 'bg-red-500 text-white' : isPast ? 'bg-green-500 text-white' : isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700'}`}>
                    {i + 1}
                  </div>
                  <div className="ml-2 text-xs font-medium mr-4">
                    {isSentBack ? STATE_LABELS['SENT_BACK'] : STATE_LABELS[state]}
                  </div>
                  {i < STATE_ORDER.length - 1 && (
                    <div className={`w-6 h-0.5 mr-4 ${isPast ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {summary.adminNote && summary.state === 'SENT_BACK' && (
          <div className="bg-red-50 dark:bg-red-900/30 p-4 rounded-xl border border-red-200 dark:border-red-800">
            <p className="text-sm font-bold text-red-600 dark:text-red-400 mb-1">Admin sent back your unload request:</p>
            <p className="text-red-700 dark:text-red-300">{summary.adminNote}</p>
          </div>
        )}

        {action && (
          <button
            onClick={action.action}
            className="w-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-bold py-3 rounded-xl text-lg shadow-sm transition-transform active:opacity-90 flex items-center justify-center"
          >
            {action.label}
          </button>
        )}
        
        {summary.state === 'ON_ROUTE' && (
          <button
            onClick={() => navigate('/sell')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-lg shadow-sm transition-transform active:opacity-90 flex gap-3 items-center justify-center"
          >
            <ShoppingCart size={24} />
            Direct Sell
          </button>
        )}
        
        {lowStockCount > 0 && (summary.state === 'NOT_STARTED' || summary.state === 'ON_ROUTE') && (
          <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }}
            onClick={() => navigate('/load-stock')}
            className="bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 p-4 rounded-xl font-medium border border-red-200 dark:border-red-800/30 flex items-center justify-between cursor-pointer active:opacity-90 transition-transform"
          >
            <div className="flex items-center">
              <AlertTriangle size={20} className="mr-3" />
              <span><span className="font-bold">{lowStockCount} items</span> are running low in vehicle.</span>
            </div>
            <span className="text-red-600 dark:text-red-400 font-bold text-sm bg-red-100 dark:bg-red-900/50 px-2 py-1 rounded">Top-up</span>
          </div>
        )}

        {summary.state !== 'ON_ROUTE' && summary.state !== 'CLOSED' && summary.state !== 'UNLOAD_REQUESTED' && summary.state !== 'APPROVED' && (
          <div className="bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300 p-4 rounded-xl text-center font-medium">
            Start your route to begin selling.
          </div>
        )}
      </div>

      <SalesAnalytics />

      <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="font-bold text-lg mb-3">Today's Accounts</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-green-50 dark:bg-green-900/10 p-3 rounded-lg border border-green-100 dark:border-green-900/30">
            <div className="flex items-center text-green-600 mb-1"><Banknote size={16} className="mr-1"/> <span className="text-xs font-bold">CASH</span></div>
            <div className="font-bold text-lg">{formatRupees(accounts.cash)}</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
            <div className="flex items-center text-blue-600 mb-1"><QrCode size={16} className="mr-1"/> <span className="text-xs font-bold">UPI</span></div>
            <div className="font-bold text-lg">{formatRupees(accounts.upi)}</div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/10 p-3 rounded-lg border border-orange-100 dark:border-orange-900/30">
            <div className="flex items-center text-orange-600 mb-1"><CreditCard size={16} className="mr-1"/> <span className="text-xs font-bold">CREDIT</span></div>
            <div className="font-bold text-lg">{formatRupees(accounts.credit)}</div>
          </div>
          <div className="bg-gray-100 dark:bg-gray-900 p-3 rounded-lg">
            <div className="flex items-center text-gray-500 mb-1"><Calculator size={16} className="mr-1"/> <span className="text-xs font-bold">TOTAL</span></div>
            <div className="font-bold text-lg">{formatRupees(accounts.total)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
