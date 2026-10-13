import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PRODUCTS, productMap } from '../data/catalog';
import { getLedger, submitLoadStock, fetchActiveWorkDay } from '../data/mockApi';
import { calculateRemainingStock, calculateVehicleStockSummary, getLowStockSuggestions, TopUpSuggestion } from '../domain/stockLedger';
import { displayToPieces, formatQuantity, piecesToDisplay } from '../domain/units';
import { Search, Plus, Minus, Download, ArrowLeft, TrendingUp } from 'lucide-react';

export default function LoadStock() {
  const navigate = useNavigate();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [ledger, setLedger] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [cart, setCart] = useState<Record<string, { boxes: number; strips: number; pieces: number }>>({});
  const [errorMsg, setErrorMsg] = useState('');
  const saving = useRef(false);
  const [suggestions, setSuggestions] = useState<TopUpSuggestion[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    Promise.all([getLedger(), fetchActiveWorkDay()]).then(([l, s]) => {
      setLedger(l);
      setSummary(s);
      
      const vehicleStock = calculateVehicleStockSummary(l, s.vehicleId, s.workDayId, s.openingStockSnapshot);
      const warehouseFn = (id: string) => calculateRemainingStock(l, id, s.warehouseId);
      
      const sugg = getLowStockSuggestions(vehicleStock, s.historicalStockLevels || {}, PRODUCTS, warehouseFn);
      setSuggestions(sugg);
    }).catch(e => setErrorMsg(e.message));
  }, []);

  const sortedProducts = useMemo(() => PRODUCTS.filter(p => p.active !== false && summary && calculateRemainingStock(ledger,p.id,summary.warehouseId)>0).sort((a, b) => a.name.localeCompare(b.name)), [ledger,summary]);

  const filteredProducts = useMemo(() => {
    if (!debouncedSearch) return sortedProducts;
    const lowerSearch = debouncedSearch.toLowerCase();
    return sortedProducts.filter(p => p.name.toLowerCase().includes(lowerSearch));
  }, [debouncedSearch, sortedProducts]);

  const updateCartAbsolute = (productId: string, totalPieces: number) => {
    setErrorMsg('');
    if (!summary) return;
    const product = productMap.get(productId)!;
    const warehouseRemaining = calculateRemainingStock(ledger, productId, summary.warehouseId);
    
    if (totalPieces > warehouseRemaining) {
      setErrorMsg(`Cannot load ${product.name}. Only ${formatQuantity(warehouseRemaining, product)} available in warehouse.`);
      return;
    }
    
    setCart(prev => ({
      ...prev,
      [productId]: piecesToDisplay(totalPieces, product)
    }));
  };

  const updateCart = (productId: string, field: 'boxes'|'strips'|'pieces', delta: number) => {
    setErrorMsg('');
    if (!summary) return;

    setCart(prev => {
      const current = prev[productId] || { boxes: 0, strips: 0, pieces: 0 };
      const nextVal = Math.max(0, current[field] + delta);
      const newDisplay = { ...current, [field]: nextVal };
      const product = productMap.get(productId)!;
      const requestedPieces = displayToPieces(newDisplay, product);
      
      const warehouseRemaining = calculateRemainingStock(ledger, productId, summary.warehouseId);
      
      if (requestedPieces > warehouseRemaining) {
        setErrorMsg(`Cannot load ${product.name}. Only ${formatQuantity(warehouseRemaining, product)} available in warehouse.`);
        return prev;
      }
      return { ...prev, [productId]: newDisplay };
    });
  };
  
  const addAllSuggestions = () => {
    suggestions.forEach(s => {
      updateCartAbsolute(s.productId, s.suggestedTopUp);
    });
    setSuggestions([]); // clear suggestions after adding
  };
  
  const addSuggestion = (productId: string, pieces: number) => {
    updateCartAbsolute(productId, pieces);
    setSuggestions(prev => prev.filter(s => s.productId !== productId));
  };

  const handleConfirm = async () => {
    if (!summary) return;
    const items = Object.entries(cart).map(([productId, display]) => {
      const p = productMap.get(productId)!;
      return {
        productId,
        quantityPieces: displayToPieces(display, p),
        boxes: display.boxes,
        strips: display.strips,
        pieces: display.pieces
      };
    }).filter(i => i.quantityPieces > 0);

    if (items.length === 0) return;

    if (confirm('Submit stock request for admin approval?')) {
      if (saving.current) return;
      saving.current = true;
      try { await submitLoadStock(summary.workDayId, summary.warehouseId, summary.vehicleId, items); navigate('/'); }
      catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Could not load stock.'); }
      finally { saving.current = false; }
    }
  };

  const hasItems = Object.values(cart).some(c => c.boxes > 0 || c.strips > 0 || c.pieces > 0);

  if (!summary) return <div className="p-4">{errorMsg || 'Loading...'}</div>;

  return (
    <div className="flex flex-col ui-workflow">
      <div className="flex items-center space-x-4 mb-4">
        <button aria-label="Go back" onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold">Load from {summary.warehouseName || summary.warehouseId}</h2>
      </div>

      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search size={20} className="text-gray-400" />
        </div>
        <input aria-label="Search warehouse..."
          type="text"
          placeholder="Search warehouse..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-lg"
        />
      </div>

      {errorMsg && (
        <div className="bg-red-100 text-red-700 p-3 rounded-xl mb-4 text-sm font-medium">
          {errorMsg}
        </div>
      )}
      
      {!searchTerm && suggestions.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-blue-800 dark:text-blue-300 flex items-center">
              <TrendingUp size={18} className="mr-2" /> Low in Vehicle
            </h3>
            <button onClick={addAllSuggestions} className="text-sm font-bold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
              Add all suggestions
            </button>
          </div>
          <div className="space-y-3">
            {suggestions.map(s => {
              const product = productMap.get(s.productId)!;
              return (
                <div key={s.productId} className="ui-card flex justify-between items-center bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-blue-100 dark:border-blue-800/50">
                  <div>
                    <div className="font-bold text-sm">{product.name}</div>
                    <div className="text-xs text-gray-500">
                      Balance: <span className="font-bold text-red-600">{formatQuantity(s.currentBalance, product)}</span> | Usual: {formatQuantity(s.usualLevel, product)}
                    </div>
                  </div>
                  <button 
                    onClick={() => addSuggestion(product.id, s.suggestedTopUp)}
                    className="text-blue-600 font-bold text-sm flex items-center bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg"
                  >
                    <Plus size={14} className="mr-1" /> Add {formatQuantity(s.suggestedTopUp, product)}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 pb-24">
        {filteredProducts.map(product => {
          const qty = cart[product.id] || { boxes: 0, strips: 0, pieces: 0 };
          const remaining = calculateRemainingStock(ledger, product.id, summary.warehouseId);
          
          return (
            <div key={product.id} className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-lg">{product.name}</h3>
                  <p className="text-sm text-gray-500">Warehouse: {formatQuantity(remaining, product)}</p>
                </div>
              </div>

              <div className="ui-quantity-grid grid grid-cols-3 gap-2">
                {(['boxes', 'strips', 'pieces'] as const).map(field => (
                  <div key={field} className="flex flex-col items-center p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <span className="text-xs text-gray-500 uppercase font-bold mb-2">{field}</span>
                    <div className="ui-stepper flex items-center space-x-3">
                      <button 
                        aria-label={`Decrease ${field} for ${product.name}`} onClick={() => updateCart(product.id, field, -1)}
                        className="w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow flex items-center justify-center active:opacity-90"
                      >
                        <Minus size={16} />
                      </button>
                      <span className="font-bold text-lg w-4 text-center">{qty[field]}</span>
                      <button 
                        aria-label={`Increase ${field} for ${product.name}`} onClick={() => updateCart(product.id, field, 1)}
                        className="w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow flex items-center justify-center active:opacity-90 text-blue-600"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {hasItems && (
        <div className="ui-actions   p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] ">
          <button
            onClick={handleConfirm}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl text-lg flex items-center justify-center space-x-2 active:opacity-90"
          >
            <Download size={20} />
            <span>Submit Stock Request</span>
          </button>
        </div>
      )}
    </div>
  );
}
