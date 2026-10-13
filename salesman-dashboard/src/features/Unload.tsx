import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchActiveWorkDay, getLedger, submitUnloadRequest, getAccountingEntries, getCashDraft, saveCashDraft, clearCashDraft } from '../data/mockApi';
import { PRODUCTS } from '../data/catalog';
import { calculateRemainingStock } from '../domain/stockLedger';
import { calculateAccountingTotals } from '../domain/accounting';
import { piecesToDisplay, displayToPieces, formatQuantity } from '../domain/units';
import { formatRupees } from '../domain/money';
import { REQUIRE_DENOMINATIONS, compareWithExpectedCash } from '../domain/cashDenominations';
import { ArrowLeft, CheckCircle, Plus, Minus, Banknote, QrCode, CreditCard, Archive, CornerUpLeft } from 'lucide-react';
import CashCounter from './CashCounter';

export default function Unload() {
  const navigate = useNavigate();
  
  const [summary, setSummary] = useState<any>(null);
  const [ledger, setLedger] = useState<any[] | null>(null);
  const [accounts, setAccounts] = useState({ cash: 0, upi: 0, credit: 0, total: 0 });
  
  // States
  const [countedStock, setCountedStock] = useState<Record<string, { boxes: number; strips: number; pieces: number }>>({});
  const [heldStock, setHeldStock] = useState<Record<string, { boxes: number; strips: number; pieces: number }>>({});
  
  const [cashBreakdown, setCashBreakdown] = useState<Record<string, number>>({});
  const [cashTotalPaise, setCashTotalPaise] = useState(0);
  const [noteCount, setNoteCount] = useState(0);
  const [coinCount, setCoinCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const debounceTimer = useRef<any>(null);

  useEffect(() => {
    fetchActiveWorkDay().then(async s => {
      setSummary(s);
      const [l, acc, draft] = await Promise.all([
        getLedger(), 
        getAccountingEntries(),
        getCashDraft(s.workDayId)
      ]);
      setLedger(l);
      setAccounts(calculateAccountingTotals(acc.filter(a => a.workDayId === s.workDayId)));
      
      // Load draft or pre-fill from SENT_BACK
      if (s.state === 'SENT_BACK' && s.cashBreakdown && Object.keys(s.cashBreakdown).length > 0) {
        setCashBreakdown(s.cashBreakdown);
      } else if (draft) {
        setCashBreakdown(draft);
      }
    }).catch(e => setSubmitError(e.message));
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, []);

  useEffect(() => {
    if (summary && ledger !== null && Object.keys(countedStock).length === 0) {
      const initialCount: any = {};
      const initialHold: any = {};
      PRODUCTS.forEach(p => {
        const expectedPieces = calculateRemainingStock(ledger, p.id, summary.vehicleId);
        initialCount[p.id] = piecesToDisplay(expectedPieces, p);
        initialHold[p.id] = { boxes: 0, strips: 0, pieces: 0 };
      });
      setCountedStock(initialCount);
      setHeldStock(initialHold);
    }
  }, [summary, ledger]);

  const handleCashChange = (breakdown: Record<string, number>, total: number, notes: number, coins: number) => {
    setCashBreakdown(breakdown);
    setCashTotalPaise(total);
    setNoteCount(notes);
    setCoinCount(coins);

    if (summary) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        saveCashDraft(summary.workDayId, breakdown);
      }, 300);
    }
  };

  const updateCount = (productId: string, field: 'boxes'|'strips'|'pieces', delta: number) => {
    setCountedStock(prev => {
      const current = prev[productId] || { boxes: 0, strips: 0, pieces: 0 };
      const nextVal = Math.max(0, current[field] + delta);
      return { ...prev, [productId]: { ...current, [field]: nextVal } };
    });
  };

  const updateHold = (productId: string, field: 'boxes'|'strips'|'pieces', delta: number) => {
    setHeldStock(prev => {
      const current = prev[productId] || { boxes: 0, strips: 0, pieces: 0 };
      const nextVal = Math.max(0, current[field] + delta);
      
      const newHold = { ...current, [field]: nextVal };
      const product = PRODUCTS.find(p => p.id === productId)!;
      const holdPieces = displayToPieces(newHold, product);
      const countPieces = displayToPieces(countedStock[productId], product);
      
      if (holdPieces > countPieces) return prev; // Cannot hold more than counted
      
      return { ...prev, [productId]: newHold };
    });
  };

  const holdAll = () => {
    setHeldStock({ ...countedStock });
  };

  const unloadAll = () => {
    const empty: any = {};
    PRODUCTS.forEach(p => empty[p.id] = { boxes: 0, strips: 0, pieces: 0 });
    setHeldStock(empty);
  };

  const { differencePaise, status: cashStatus } = compareWithExpectedCash(cashTotalPaise, accounts.cash);

  const handleSubmit = async () => {
    if (!summary || submitting) return;
    if (REQUIRE_DENOMINATIONS && accounts.cash > 0 && cashTotalPaise === 0) {
      alert('Please count your cash using the breakdown counter.');
      return;
    }

    const heldItems: Record<string, number> = {};
    const unloadedItems: Record<string, number> = {};
    let totalHeld = 0;
    let totalUnloaded = 0;

    PRODUCTS.forEach(p => {
      if (!countedStock[p.id]) return;
      const countPcs = displayToPieces(countedStock[p.id], p);
      const holdPcs = displayToPieces(heldStock[p.id] || { boxes: 0, strips: 0, pieces: 0 }, p);
      const unloadPcs = countPcs - holdPcs;
      
      if (holdPcs > 0) {
        heldItems[p.id] = holdPcs;
        totalHeld += holdPcs;
      }
      if (unloadPcs > 0) {
        unloadedItems[p.id] = unloadPcs;
        totalUnloaded += unloadPcs;
      }
    });

    const msg = `Submit unload request?\n\nHeld in van: ${totalHeld} pcs\nReturn to warehouse: ${totalUnloaded} pcs\n\nYou will not be able to sell or load stock until admin approves.`;
    if (confirm(msg)) {
      setSubmitting(true);
      setSubmitError('');
      try {
        await submitUnloadRequest(summary.workDayId, cashTotalPaise, heldItems, unloadedItems, cashBreakdown, cashTotalPaise, noteCount, coinCount);
        await clearCashDraft(summary.workDayId);
        navigate('/');
      } catch (error) {
        console.error('Failed to submit unload request', error);
        setSubmitError(error instanceof Error ? error.message : 'Could not submit the unload request.');
      } finally {
        setSubmitting(false);
      }
    }
  };

  if (!summary || ledger === null) return <div className="p-4">{submitError || 'Loading...'}</div>;

  const isSubmitDisabled = REQUIRE_DENOMINATIONS && accounts.cash > 0 && cashTotalPaise === 0;

  return (
    <div className="flex flex-col ui-workflow">
      <div className="flex items-center space-x-4 mb-4">
        <button aria-label="Go back" onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold">End Day Unload</h2>
      </div>

      <div className="space-y-6">
        <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-bold mb-4">Payment Breakdown</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-blue-50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
              <div className="flex items-center text-blue-600 mb-1"><QrCode size={16} className="mr-1"/> <span className="text-xs font-bold">UPI</span></div>
              <div className="font-bold text-lg">{formatRupees(accounts.upi)}</div>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/10 p-3 rounded-lg border border-orange-100 dark:border-orange-900/30">
              <div className="flex items-center text-orange-600 mb-1"><CreditCard size={16} className="mr-1"/> <span className="text-xs font-bold">CREDIT</span></div>
              <div className="font-bold text-lg">{formatRupees(accounts.credit)}</div>
            </div>
          </div>
          
          <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-xl border border-green-200 dark:border-green-900/30 mb-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center text-green-700 dark:text-green-400 font-bold">
                <Banknote size={20} className="mr-2"/> Expected CASH
              </div>
              <span className="font-bold text-2xl text-green-700 dark:text-green-400">{formatRupees(accounts.cash)}</span>
            </div>
            
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mt-4 mb-2">
              Actual Cash Collected (₹) <span className="text-xs font-normal text-gray-500 block">Calculated from your note and coin count</span>
            </label>
            <div className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-gray-100 dark:bg-gray-900 text-xl font-bold text-gray-800 dark:text-gray-200">
              {formatRupees(cashTotalPaise)}
            </div>
          </div>

          <CashCounter 
            expectedCashPaise={accounts.cash}
            initialBreakdown={cashBreakdown}
            onChange={handleCashChange}
          />

          {cashTotalPaise > 0 && (
            <div className={`mt-4 p-3 rounded-lg font-bold text-center ${
              cashStatus === 'MATCH' ? 'bg-green-100 text-green-700' : 
              cashStatus === 'EXCESS' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
            }`}>
              {cashStatus === 'MATCH' ? 'CASH MATCH' : 
               cashStatus === 'EXCESS' ? `EXCESS: ${formatRupees(differencePaise)}` : 
               `SHORTAGE: ${formatRupees(Math.abs(differencePaise))}`}
            </div>
          )}
        </div>

        {/* Stock Section */}
        <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold">Count & Hold Stock</h3>
          </div>
          
          <div className="flex space-x-2 mb-4">
            <button onClick={holdAll} className="flex-1 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 py-2 rounded-lg font-bold text-sm flex items-center justify-center">
              <Archive size={16} className="mr-1" /> Hold All
            </button>
            <button onClick={unloadAll} className="flex-1 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 py-2 rounded-lg font-bold text-sm flex items-center justify-center">
              <CornerUpLeft size={16} className="mr-1" /> Unload All
            </button>
          </div>
          
          <div className="space-y-6">
            {PRODUCTS.map(product => {
              const expectedPieces = calculateRemainingStock(ledger, product.id, summary.vehicleId);
              if (expectedPieces === 0) return null;
              
              const qty = countedStock[product.id] || { boxes: 0, strips: 0, pieces: 0 };
              const holdQty = heldStock[product.id] || { boxes: 0, strips: 0, pieces: 0 };
              
              const countedPieces = displayToPieces(qty, product);
              const heldPieces = displayToPieces(holdQty, product);
              const diff = countedPieces - expectedPieces;
              const unloadPieces = countedPieces - heldPieces;
              
              return (
                <div key={product.id} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 border-b border-gray-100 dark:border-gray-700 flex justify-between items-start">
                    <div>
                      <div className="font-bold">{product.name}</div>
                      <div className="text-xs text-gray-500">Expected: {formatQuantity(expectedPieces, product)}</div>
                    </div>
                    {diff !== 0 && (
                      <div className="text-xs font-bold bg-red-100 text-red-600 px-2 py-1 rounded">
                        Diff: {diff > 0 ? '+' : ''}{diff} pcs
                      </div>
                    )}
                  </div>
                  
                  <div className="p-3 space-y-4">
                    {/* Counted Row */}
                    <div>
                      <div className="text-xs font-bold text-gray-500 mb-2 uppercase">Counted Remaining</div>
                      <div className="ui-quantity-grid grid grid-cols-3 gap-2">
                        {(['boxes', 'strips', 'pieces'] as const).map(field => (
                          <div key={field} className="flex flex-col items-center p-1 bg-gray-50 dark:bg-gray-900 rounded">
                            <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">{field}</span>
                            <div className="ui-stepper flex items-center space-x-2">
                              <button aria-label={`Decrease counted ${field} for ${product.name}`} onClick={() => updateCount(product.id, field, -1)} className="w-8 h-8 flex justify-center items-center bg-white dark:bg-gray-800 rounded shadow"><Minus size={14}/></button>
                              <span className="font-bold text-sm w-4 text-center">{qty[field]}</span>
                              <button aria-label={`Increase counted ${field} for ${product.name}`} onClick={() => updateCount(product.id, field, 1)} className="w-8 h-8 flex justify-center items-center bg-white dark:bg-gray-800 rounded shadow"><Plus size={14}/></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Held Row */}
                    <div className="bg-amber-50 dark:bg-amber-900/10 p-2 rounded-lg border border-amber-100 dark:border-amber-900/20">
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase flex items-center">
                          <Archive size={12} className="mr-1"/> Hold Overnight
                        </div>
                        <div className="text-xs font-bold text-blue-700 dark:text-blue-400">
                          Unload: {formatQuantity(unloadPieces, product)}
                        </div>
                      </div>
                      <div className="ui-quantity-grid grid grid-cols-3 gap-2">
                        {(['boxes', 'strips', 'pieces'] as const).map(field => (
                          <div key={field} className="ui-card flex flex-col items-center p-1 bg-white dark:bg-gray-900 rounded">
                            <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">{field}</span>
                            <div className="ui-stepper flex items-center space-x-2">
                              <button aria-label={`Decrease held ${field} for ${product.name}`} onClick={() => updateHold(product.id, field, -1)} className="w-8 h-8 flex justify-center items-center bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"><Minus size={14}/></button>
                              <span className="font-bold text-sm w-4 text-center">{holdQty[field]}</span>
                              <button aria-label={`Increase held ${field} for ${product.name}`} onClick={() => updateHold(product.id, field, 1)} className="w-8 h-8 flex justify-center items-center bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"><Plus size={14}/></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="ui-actions p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 print:hidden z-40">
        {submitError && (
          <div role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {submitError}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={isSubmitDisabled || submitting}
          className={`w-full font-bold py-4 rounded-xl text-lg flex items-center justify-center space-x-2 ${
            isSubmitDisabled || submitting ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          <CheckCircle size={20} />
          <span>{submitting ? 'Submitting...' : 'Submit Unload Request'}</span>
        </button>
      </div>
    </div>
  );
}
