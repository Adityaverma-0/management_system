import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getInvoices, getAccountingEntries, fetchActiveWorkDay } from '../data/mockApi';
import { Invoice } from '../domain/types';
import { formatRupees } from '../domain/money';
import { productMap } from '../data/catalog';
import { formatQuantity } from '../domain/units';
import { calculateAccountingTotals } from '../domain/accounting';
import { FileText, Printer, Banknote, QrCode, CreditCard } from 'lucide-react';
import CashBreakdownTable from './CashBreakdownTable';

export default function Summary() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState({ cash: 0, upi: 0, credit: 0, total: 0 });

  const [summary, setSummary] = useState<any>(null);

  const loadData = async () => {
    const s = await fetchActiveWorkDay();
    setSummary(s);
    
    const invs = await getInvoices();
    setInvoices(invs.filter(i => i.workDayId === s.workDayId));
    
    const acc = await getAccountingEntries();
    const todayAcc = acc.filter(a => a.workDayId === s.workDayId);
    setAccounts(calculateAccountingTotals(todayAcc));
  };

  useEffect(() => {
    loadData();
    window.addEventListener('focus', loadData);
    return () => window.removeEventListener('focus', loadData);
  }, []);

  return (
    <div className="space-y-4 pb-4">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 rounded-2xl shadow-lg mb-6">
        <h2 className="text-2xl font-bold mb-1 flex items-center">
          <FileText className="mr-2" /> Day Summary
        </h2>
        <div className="mt-4">
          <p className="opacity-80 text-sm mb-1">Total Sales Amount</p>
          <p className="text-4xl font-bold">{formatRupees(accounts.total)}</p>
        </div>
      </div>

      <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="font-bold text-lg mb-3">Accounts Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-1">
          <div className="bg-green-50 dark:bg-green-900/10 p-2 rounded-lg text-center border border-green-100 dark:border-green-900/30">
            <div className="text-green-600 text-[10px] font-bold mb-1"><Banknote size={12} className="inline mr-1"/>CASH</div>
            <div className="font-bold text-sm">{formatRupees(accounts.cash)}</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/10 p-2 rounded-lg text-center border border-blue-100 dark:border-blue-900/30">
            <div className="text-blue-600 text-[10px] font-bold mb-1"><QrCode size={12} className="inline mr-1"/>UPI</div>
            <div className="font-bold text-sm">{formatRupees(accounts.upi)}</div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/10 p-2 rounded-lg text-center border border-orange-100 dark:border-orange-900/30">
            <div className="text-orange-600 text-[10px] font-bold mb-1"><CreditCard size={12} className="inline mr-1"/>CREDIT</div>
            <div className="font-bold text-sm">{formatRupees(accounts.credit)}</div>
          </div>
        </div>

        {summary && summary.state === 'CLOSED' && summary.cashBreakdown && (
          <div className="mt-4">
            <CashBreakdownTable 
              breakdown={summary.cashBreakdown}
              totalPaise={summary.cashTotalPaise || 0}
              noteCount={summary.noteCount || 0}
              coinCount={summary.coinCount || 0}
            />
          </div>
        )}
      </div>

      {summary && summary.state === 'CLOSED' && summary.heldItems && Object.keys(summary.heldItems).length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800/30">
          <h3 className="font-bold text-lg text-amber-800 dark:text-amber-400 mb-3">Held for tomorrow</h3>
          <div className="space-y-2">
            {Object.entries(summary.heldItems).map(([productId, qty]: [string, any]) => {
              const product = productMap.get(productId)!;
              if (qty === 0) return null;
              return (
                <div key={productId} className="flex justify-between items-center text-sm font-medium">
                  <span>{product.name}</span>
                  <span className="bg-amber-100 dark:bg-amber-900/50 px-2 py-1 rounded text-amber-700 dark:text-amber-300 font-bold">{formatQuantity(qty, product)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {summary && summary.state === 'CLOSED' && summary.unloadedItems && Object.keys(summary.unloadedItems).length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800/30">
          <h3 className="font-bold text-lg text-blue-800 dark:text-blue-400 mb-3">Returned to Warehouse</h3>
          <div className="space-y-2">
            {Object.entries(summary.unloadedItems).map(([productId, qty]: [string, any]) => {
              const product = productMap.get(productId)!;
              if (qty === 0) return null;
              return (
                <div key={productId} className="flex justify-between items-center text-sm font-medium">
                  <span>{product.name}</span>
                  <span className="bg-blue-100 dark:bg-blue-900/50 px-2 py-1 rounded text-blue-700 dark:text-blue-300 font-bold">{formatQuantity(qty, product)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h3 className="font-bold text-lg px-2 mt-6">Sales History (Invoices)</h3>
      {invoices.length === 0 ? (
        <div className="text-center p-8 text-gray-500 bg-gray-50 dark:bg-gray-900 rounded-xl">
          No sales yet today.
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.slice().reverse().map(invoice => {
            const isActive = invoice.status === 'VALID';
            return (
              <div key={invoice.id} className={`p-4 rounded-xl shadow-sm border ${isActive ? 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700' : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 opacity-70'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className={`font-bold ${isActive ? '' : 'line-through text-gray-500'}`}>{invoice.invoiceNumber}</h4>
                    <p className="text-xs font-bold mt-1 text-gray-600">Outlet: {invoice.outletId}</p>
                    <p className="text-xs text-gray-500">{new Date(invoice.createdAt).toLocaleTimeString()}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500 line-through'}`}>
                      {formatRupees(invoice.totalAmountPaise)}
                    </p>
                    {!isActive && <span className="text-xs text-red-500 font-bold border border-red-500 px-1 rounded inline-block mt-1">VOID</span>}
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  {invoice.items.map((item, idx) => {
                    const p = item.productSnapshot || productMap.get(item.productId)!;
                    return (
                      <div key={idx} className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                        <span>{formatQuantity(item.quantityPieces, p)} {p.name}</span>
                        <span>{formatRupees(item.lineTotalPaise)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <button 
                    onClick={() => navigate(`/print/${invoice.id}`)}
                    className="w-full py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40 rounded-lg text-sm font-bold flex items-center justify-center transition-colors"
                  >
                    <Printer size={16} className="mr-2" /> View / Reprint
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
