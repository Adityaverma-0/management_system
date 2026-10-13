import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Customer, SaleItem, PaymentMode } from '../../domain/types';
import { PRODUCTS, productMap } from '../../data/catalog';
import { getLedger, saveSaleGenerateInvoice, fetchActiveWorkDay, getCustomers, getTaxSettings } from '../../data/mockApi';

import { calculateRemainingStock } from '../../domain/stockLedger';
import { displayToPieces, formatQuantity } from '../../domain/units';
import { formatRupees, formatPayable } from '../../domain/money';
import { validatePaymentMode } from '../../domain/payments';
import { Search, Plus, Minus, ShoppingCart, ArrowLeft, CheckCircle, CreditCard, Banknote, QrCode } from 'lucide-react';

export default function SaleEntry() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [ledger, setLedger] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [customer, setCustomer] = useState<Customer | undefined>();
  const tax = useMemo(() => getTaxSettings(), []);
  
  const [cart, setCart] = useState<Record<string, { boxes: number; strips: number; pieces: number }>>({});
  const [errorMsg, setErrorMsg] = useState('');
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  
  // Payment step state
  const [step, setStep] = useState<'ITEMS' | 'PAYMENT'>('ITEMS');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [paymentRef, setPaymentRef] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    getLedger().then(setLedger).catch(e => setErrorMsg(e.message));
    fetchActiveWorkDay().then(setSummary).catch(e => setErrorMsg(e.message));
    if (customerId && customerId !== 'walk-in') {
      getCustomers().then(custs => {
        setCustomer(custs.find(c => c.id === customerId));
      });
    }
  }, [customerId]);

  const sortedProducts = useMemo(() => {
    return PRODUCTS.filter(p => p.active !== false && summary && calculateRemainingStock(ledger,p.id,summary.vehicleId)>0).sort((a, b) => a.name.localeCompare(b.name));
  }, [ledger, summary]);

  const filteredProducts = useMemo(() => {
    if (!debouncedSearch) return sortedProducts;
    const lowerSearch = debouncedSearch.toLowerCase();
    
    let left = 0, right = sortedProducts.length - 1, startIdx = -1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const name = sortedProducts[mid].name.toLowerCase();
      if (name.startsWith(lowerSearch)) {
        startIdx = mid;
        right = mid - 1; 
      } else if (name < lowerSearch) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    if (startIdx === -1) {
      return sortedProducts.filter(p => p.name.toLowerCase().includes(lowerSearch));
    }
    const matches = [];
    for (let i = startIdx; i < sortedProducts.length; i++) {
      if (sortedProducts[i].name.toLowerCase().startsWith(lowerSearch)) {
        matches.push(sortedProducts[i]);
      } else break;
    }
    return matches;
  }, [debouncedSearch, sortedProducts]);

  const subtotalPaise = useMemo(() => {
    let total = 0;
    for (const [productId, display] of Object.entries(cart)) {
      const p = productMap.get(productId)!;
      total += displayToPieces(display, p) * p.pricePaise;
    }
    return total;
  }, [cart]);

  const taxBreakdown = useMemo(() => {
    const cgstAmount = Math.round(subtotalPaise * (tax.cgst || 0) / 100);
    const sgstAmount = Math.round(subtotalPaise * (tax.sgst || 0) / 100);
    return { cgstAmount, sgstAmount, total: Math.floor((subtotalPaise + cgstAmount + sgstAmount + 50) / 100) * 100 };
  }, [subtotalPaise, tax]);
const updateCart = (productId: string, field: 'boxes'|'strips'|'pieces', delta: number) => {
    setErrorMsg('');
    if (!summary) return;

    setCart(prev => {
      const current = prev[productId] || { boxes: 0, strips: 0, pieces: 0 };
      const nextVal = Math.max(0, current[field] + delta);
      const newDisplay = { ...current, [field]: nextVal };
      const p = productMap.get(productId)!;
      const requestedPieces = displayToPieces(newDisplay, p);
      
      const vehicleRemaining = calculateRemainingStock(ledger, productId, summary.vehicleId);
      if (requestedPieces > vehicleRemaining) {
        setErrorMsg(`Cannot add ${p.name}. Only ${formatQuantity(vehicleRemaining, p)} available in vehicle.`);
        return prev;
      }
      return { ...prev, [productId]: newDisplay };
    });
  };

  const handleGoToPayment = () => {
    if (taxBreakdown.total === 0) return;
    setStep('PAYMENT');
    setPaymentMode('CASH');
    setErrorMsg('');
  };

  const handleSaveBill = async () => {
    if (!summary) return;
    setErrorMsg('');

    const err = validatePaymentMode(paymentMode, taxBreakdown.total, customer);
    if (err) {
      setErrorMsg(err);
      return;
    }

    const items: SaleItem[] = [];
    for (const [productId, display] of Object.entries(cart)) {
      const p = productMap.get(productId)!;
      const pieces = displayToPieces(display, p);
      if (pieces > 0) {
        items.push({ productId, quantityPieces: pieces, lineTotalPaise: pieces * p.pricePaise });
      }
    }
    const cgstAmount = taxBreakdown.cgstAmount;
    const sgstAmount = taxBreakdown.sgstAmount;
    const grandTotal = taxBreakdown.total;

    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const invoiceId = await saveSaleGenerateInvoice(summary.workDayId, {
        salesmanId: summary.salesmanId,
        vehicleId: summary.vehicleId,
        outletId: 'DIRECT-SELL', // fallback for old schema
        customerId: customerId,
        items,
        totalAmountPaise: grandTotal,
        subtotalPaise: subtotalPaise,
        cgstPercent: tax.cgst,
        sgstPercent: tax.sgst,
        cgstAmountPaise: cgstAmount,
        sgstAmountPaise: sgstAmount,
        paymentMode,
        paymentRef: paymentMode === 'UPI' ? paymentRef : undefined
      });
      navigate(`/print/${invoiceId}`, { replace: true });
    } catch (e: any) {
      setErrorMsg(e.message || 'Error saving bill');
    } finally { saving.current = false; setBusy(false); }
  };

  if (!summary) return <div className="p-4">{errorMsg || 'Loading...'}</div>;
  if (summary.state !== 'ON_ROUTE') return <div className="p-4">Start your route before creating a sale.</div>;

  if (step === 'PAYMENT') {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950 pb-40">
        <div className="bg-white dark:bg-gray-900 shadow-sm px-4 py-3 flex items-center sticky top-0 z-40">
          <button onClick={() => setStep('ITEMS')} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
            <ArrowLeft size={24} />
          </button>
          <h2 className="text-xl font-bold ml-2">Payment</h2>
        </div>

        <div className="p-4 space-y-6">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center">
            {(tax.cgst > 0 || tax.sgst > 0) ? (
              <div className="mb-3 text-sm text-gray-500 space-y-1 border-b border-gray-100 dark:border-gray-700 pb-3">
                <div className="flex justify-between">
                  <span>Taxable Amount:</span>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{formatRupees(subtotalPaise)}</span>
                </div>
                {tax.cgst > 0 && (
                  <div className="flex justify-between">
                    <span>CGST ({tax.cgst}%):</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">{formatRupees(taxBreakdown.cgstAmount)}</span>
                  </div>
                )}
                {tax.sgst > 0 && (
                  <div className="flex justify-between">
                    <span>SGST ({tax.sgst}%):</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">{formatRupees(taxBreakdown.sgstAmount)}</span>
                  </div>
                )}
              </div>
            ) : null}
            <p className="text-gray-500 mb-1">Total Bill Amount</p>
            <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">{formatPayable(taxBreakdown.total)}</p>
            {customer && (
              <p className="text-sm font-bold mt-2 text-gray-600">Customer: {customer.name}</p>
            )}
            {!customer && <p className="text-sm font-bold mt-2 text-gray-600">Walk-in Customer</p>}
          </div>

          {errorMsg && (
            <div className="bg-red-100 text-red-700 p-4 rounded-xl font-bold">
              {errorMsg}
            </div>
          )}

          <div className="space-y-3">
            <button 
              onClick={() => setPaymentMode('CASH')}
              className={`w-full flex items-center p-4 rounded-xl border-2 transition-colors ${paymentMode === 'CASH' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}
            >
              <Banknote size={28} className={paymentMode === 'CASH' ? 'text-green-600' : 'text-gray-400'} />
              <div className="ml-4 text-left flex-1">
                <p className="font-bold text-lg">CASH</p>
                <p className="text-sm text-gray-500">Collect {formatPayable(taxBreakdown.total)}</p>
              </div>
              {paymentMode === 'CASH' && <CheckCircle size={24} className="text-green-500" />}
            </button>

            <button 
              onClick={() => setPaymentMode('UPI')}
              className={`w-full flex items-center p-4 rounded-xl border-2 transition-colors ${paymentMode === 'UPI' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}
            >
              <QrCode size={28} className={paymentMode === 'UPI' ? 'text-blue-600' : 'text-gray-400'} />
              <div className="ml-4 text-left flex-1">
                <p className="font-bold text-lg">UPI</p>
                <p className="text-sm text-gray-500">Scan QR & Receive</p>
              </div>
              {paymentMode === 'UPI' && <CheckCircle size={24} className="text-blue-500" />}
            </button>

            {paymentMode === 'UPI' && (
              <div className="px-4 py-2 animate-in slide-in-from-top-2">
                <input 
                  type="text" placeholder="UPI Reference (Optional)" value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900"
                />
              </div>
            )}

            <button 
              onClick={() => setPaymentMode('CREDIT')}
              disabled={!customer}
              className={`w-full flex items-center p-4 rounded-xl border-2 transition-colors ${!customer ? 'opacity-50 cursor-not-allowed' : paymentMode === 'CREDIT' ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}
            >
              <CreditCard size={28} className={paymentMode === 'CREDIT' ? 'text-orange-600' : 'text-gray-400'} />
              <div className="ml-4 text-left flex-1">
                <p className="font-bold text-lg">CREDIT</p>
                {customer ? (
                  <p className="text-sm text-gray-500">
                    New Bal: {formatRupees(customer.outstandingBalancePaise + taxBreakdown.total)}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">Not allowed for walk-in</p>
                )}
              </div>
              {paymentMode === 'CREDIT' && <CheckCircle size={24} className="text-orange-500" />}
            </button>
          </div>
        </div>

        <div className="fixed left-0 right-0 p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 z-40" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}>
          <button
            disabled={busy} onClick={handleSaveBill}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl text-lg flex items-center justify-center space-x-2 active:scale-95 transition-transform"
          >
            <span>Save & Print Bill</span>
          </button>
        </div>
      </div>
    );
  }

  // ITEMS STEP
  return (
    <div className="flex flex-col h-[calc(100vh-64px)] pb-16 bg-gray-50 dark:bg-gray-950">
      <div className="bg-white dark:bg-gray-900 shadow-sm px-4 py-3 flex items-center sticky top-0 z-40">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
          <ArrowLeft size={24} />
        </button>
        <div className="ml-2">
          <h2 className="text-xl font-bold">Add Items</h2>
          <p className="text-xs text-gray-500">{customer ? customer.name : 'Walk-in Customer'}</p>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={20} className="text-gray-400" />
          </div>
          <input
            type="text" placeholder="Search products..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-lg"
          />
        </div>

        {errorMsg && (
          <div className="bg-red-100 text-red-700 p-3 rounded-xl mb-4 text-sm font-bold">
            {errorMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-3 pb-40">
          {filteredProducts.map(product => {
            const qty = cart[product.id] || { boxes: 0, strips: 0, pieces: 0 };
            const remaining = calculateRemainingStock(ledger, product.id, summary.vehicleId);
            
            return (
              <div key={product.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-lg">{product.name}</h3>
                    <p className="text-sm text-gray-500">In Van: {formatQuantity(remaining, product)} • {formatRupees(product.pricePaise * (product.unitsPerStrip || 1))}/strip</p>
                  </div>
                  <div className="text-right font-bold text-blue-600 dark:text-blue-400">
                    {formatRupees(displayToPieces(qty, product) * product.pricePaise)}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(['boxes', 'strips', 'pieces'] as const).map(field => (
                    <div key={field} className="flex flex-col items-center p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                      <span className="text-xs text-gray-500 uppercase font-bold mb-2">{field}</span>
                      <div className="flex items-center space-x-3">
                        <button aria-label={`Decrease ${field} for ${product.name}`} onClick={() => updateCart(product.id, field, -1)} className="w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow flex items-center justify-center active:scale-95"><Minus size={16} /></button>
                        <span className="font-bold text-lg w-4 text-center">{qty[field]}</span>
                        <button aria-label={`Increase ${field} for ${product.name}`} onClick={() => updateCart(product.id, field, 1)} className="w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow flex items-center justify-center active:scale-95 text-blue-600"><Plus size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {subtotalPaise > 0 && (
        <div className="fixed bottom-16 left-0 right-0 p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 z-50">
          {(tax.cgst > 0 || tax.sgst > 0) && (
            <div className="mb-2 text-xs text-gray-500 space-y-1">
              <div className="flex justify-between">
                <span>Taxable Amount:</span>
                <span>{formatRupees(subtotalPaise)}</span>
              </div>
              {tax.cgst > 0 && (
                <div className="flex justify-between">
                  <span>CGST ({tax.cgst}%):</span>
                  <span>{formatRupees(taxBreakdown.cgstAmount)}</span>
                </div>
              )}
              {tax.sgst > 0 && (
                <div className="flex justify-between">
                  <span>SGST ({tax.sgst}%):</span>
                  <span>{formatRupees(taxBreakdown.sgstAmount)}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600 dark:text-gray-400 font-bold">Total Payable</span>
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatPayable(taxBreakdown.total)}</span>
          </div>
          <button
            onClick={handleGoToPayment}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl text-lg flex items-center justify-center space-x-2 active:scale-95 transition-transform"
          >
            <ShoppingCart size={20} />
            <span>Proceed to Payment</span>
          </button>
        </div>
      )}
    </div>
  );
}
