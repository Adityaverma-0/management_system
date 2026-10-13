import { useEffect, useState, useMemo } from 'react';
import { getLedger, fetchActiveWorkDay } from '../data/mockApi';
import { calculateVehicleStockSummary, getLowStockSuggestions, calculateRemainingStock } from '../domain/stockLedger';
import { PRODUCTS } from '../data/catalog';
import { formatQuantity } from '../domain/units';
import { Package, AlertCircle, Clock } from 'lucide-react';

export default function VehicleStock() {
  const [error, setError] = useState('');
  const [ledger, setLedger] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    const load = () => {
      getLedger().then(setLedger).catch(e => setError(e.message));
      fetchActiveWorkDay().then(setSummary).catch(e => setError(e.message));
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  const stockSummary = useMemo(() => {
  if (!summary) return new Map();
    return calculateVehicleStockSummary(ledger, summary.vehicleId, summary.workDayId, summary.openingStockSnapshot);
  }, [ledger, summary]);
  
  const lowStockIds = useMemo(() => {
  if (!summary) return new Set<string>();
    const warehouseFn = (id: string) => calculateRemainingStock(ledger, id, summary.warehouseId);
    const suggs = getLowStockSuggestions(stockSummary, summary.historicalStockLevels || {}, PRODUCTS, warehouseFn);
    return new Set(suggs.map(s => s.productId));
  }, [stockSummary, summary, ledger]);

  if (error) return <div role="alert">{error}<button onClick={() => window.location.reload()}>Retry</button></div>;
  if (!summary) return <div className="p-4">Loading...</div>;

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-blue-600 text-white p-6 rounded-2xl shadow-lg mb-6">
        <h2 className="text-2xl font-bold mb-1 flex items-center">
          <Package className="mr-2" /> Vehicle Stock
        </h2>
        <p className="opacity-80 text-sm">Real-time inventory from your ledger</p>
      </div>

      <div className="space-y-3">
        {PRODUCTS.map(product => {
          const stats = stockSummary.get(product.id) || { loaded: 0, sold: 0, remaining: 0 };
          const opening = summary.openingStockSnapshot[product.id] || 0;
          const heldDays = summary.heldDays?.[product.id] || 0;
          const isLow = lowStockIds.has(product.id);

          return (
            <div key={product.id} className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-lg">{product.name}</h3>
                <div className="flex items-center space-x-2">
                  {heldDays >= 3 && stats.remaining > 0 && (
                    <span className="flex items-center text-xs font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                      <Clock size={12} className="mr-1" /> Held {heldDays} days
                    </span>
                  )}
                  {isLow && (
                    <span className="flex items-center text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded-full">
                      <AlertCircle size={12} className="mr-1" /> LOW
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="bg-amber-50 dark:bg-amber-900/10 p-2 rounded-lg">
                  <div className="text-amber-700 text-[9px] uppercase font-bold mb-1">Opening</div>
                  <div className="font-medium text-xs">{formatQuantity(opening, product)}</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded-lg">
                  <div className="text-gray-500 text-[9px] uppercase font-bold mb-1">Loaded</div>
                  <div className="font-medium text-xs">{formatQuantity(stats.loaded, product)}</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded-lg">
                  <div className="text-gray-500 text-[9px] uppercase font-bold mb-1">Sold</div>
                  <div className="font-medium text-xs text-red-500">{formatQuantity(stats.sold, product)}</div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg border border-blue-100 dark:border-blue-800">
                  <div className="text-blue-600 dark:text-blue-400 text-[9px] uppercase font-bold mb-1">Remaining</div>
                  <div className="font-bold text-xs text-blue-700 dark:text-blue-300">{formatQuantity(stats.remaining, product)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
