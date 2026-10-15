import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getInvoice } from '../data/mockApi';
import { Invoice } from '../domain/types';
import { productMap } from '../data/catalog';
import { formatQuantity } from '../domain/units';
import { formatRupees, formatPayable } from '../domain/money';
import { Printer, Check, RotateCcw } from 'lucide-react';
import { cancelInvoice } from '../data/mockApi';

export default function InvoicePrint() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [showUndo, setShowUndo] = useState(true);

  useEffect(() => {
    getInvoice(invoiceId!).then(inv => { if (!inv) throw new Error('Invoice not found.'); setInvoice(inv); setCanCancel(inv.workDayState === 'ON_ROUTE'); }).catch(e => setError(e.message));
    

    const timer = setTimeout(() => setShowUndo(false), 10000); // 10s undo window
    return () => clearTimeout(timer);
  }, [invoiceId]);

  if (error) return <div role="alert" className="p-4">{error}<button onClick={() => window.location.reload()}>Retry</button></div>;
  if (!invoice) return <div className="p-4">Loading Invoice...</div>;

  const handlePrint = () => {
    window.print();
  };

  const handleUndo = async () => {
    if (confirm('Are you sure you want to cancel this sale? Stock and balances will be reversed.')) {
      try { await cancelInvoice(invoice.id); navigate(-1); } catch (e) { setError(e instanceof Error ? e.message : 'Cancellation failed.'); }
    }
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-900 min-h-screen pt-4 pb-24">
      {/* Action Buttons - Hidden when printing */}
      <div className="px-4 mb-4 space-y-3 print:hidden max-w-xl mx-auto">
        <button 
          onClick={handlePrint}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-lg flex items-center justify-center space-x-2"
        >
          <Printer size={20} />
          <span>Print Bill</span>
        </button>
        
        <button 
          onClick={() => navigate('/')}
          className="w-full bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 font-bold py-3 rounded-xl text-lg flex items-center justify-center space-x-2"
        >
          <Check size={20} />
          <span>Done</span>
        </button>
        
        <button 
          onClick={() => navigate('/sell')}
          className="w-full bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-bold py-3 rounded-xl flex items-center justify-center space-x-2"
        >
          <span>New Sale</span>
        </button>

        {invoice.status === 'VALID' && canCancel && showUndo && (
          <button 
            onClick={handleUndo}
            className="w-full mt-4 bg-red-100 text-red-600 font-bold py-3 rounded-xl flex items-center justify-center space-x-2 animate-pulse"
          >
            <RotateCcw size={18} />
            <span>Undo Sale (Available for 10s)</span>
          </button>
        )}
      </div>

      {/* The Printable Invoice Area - designed for 80mm thermal printers (approx 300px wide) */}
      <div className="bg-white text-black max-w-[320px] mx-auto p-4 font-mono text-sm shadow-md print:shadow-none print:p-0 print:m-0 print:max-w-none">
        <div className="text-center border-b border-black pb-2 mb-2">
          <h2 className="font-bold text-xl uppercase break-words">{invoice.businessName || 'FMCG Van Sales'}</h2>
          <p className="text-xs">GSTIN: {invoice.gstin || 'Not configured'}</p>
          <p className="text-xs">Invoice / Cash Receipt</p>
          <p className="text-xs mt-1">Date: {new Date(invoice.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).replace(/\b(am|pm)\b/g, value => value.toUpperCase())}</p>
        </div>
        
        <div className="mb-2">
          <p><strong>Inv No:</strong> {invoice.invoiceNumber}</p>
          {invoice.status === 'VOID' && (
            <p className="text-red-500 font-bold text-lg border-2 border-red-500 text-center my-2 p-1">VOID</p>
          )}
          <p><strong>Salesman:</strong> {invoice.salesmanName || invoice.salesmanId}</p>
          {invoice.salesmanPhone && <p><strong>Phone:</strong> {invoice.salesmanPhone}</p>}
          
          <p className="mt-1"><strong>Customer:</strong> {invoice.customerName || 'Walk-in'}</p>
        </div>

        <div className="border-t border-b border-black py-2 mb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-black">
                <th className="text-left py-1 w-1/2">Item</th>
                <th className="text-right py-1">Qty</th>
                <th className="text-right py-1">Amt</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map(item => {
                const p = item.productSnapshot || productMap.get(item.productId)!;
                return (
                  <tr key={item.productId} className="align-top">
                    <td className="py-1 pr-1">{p.name}</td>
                    <td className="text-right py-1 pr-1">{formatQuantity(item.quantityPieces, p)}</td>
                    <td className="text-right py-1">{formatRupees(item.lineTotalPaise)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="py-2 border-b border-black">
          <div className="text-right text-base font-bold flex justify-between">
            <span>Grand Total:</span>
            <span>{formatPayable(invoice.totalAmountPaise)}</span>
          </div>
          <p className="text-center text-xs mt-1">GST included in Final Amount</p>
        </div>

        <div className="text-[11px] mt-2 pb-2 border-b border-black border-dashed">
          <div className="flex justify-between font-bold">
            <span>PAYMENT MODE:</span>
            <span>{invoice.paymentMode || 'CASH'}</span>
          </div>
          {invoice.paymentMode === 'UPI' && invoice.paymentRef && (
            <div className="flex justify-between mt-1">
              <span>Ref:</span>
              <span>{invoice.paymentRef}</span>
            </div>
          )}
          {invoice.paymentMode === 'CREDIT' && (
            <div className="mt-2 p-2 border border-black border-dashed">
              <div className="flex justify-between"><span>Prev Bal:</span> <span>{formatRupees(invoice.previousBalancePaise || 0)}</span></div>
              <div className="flex justify-between"><span>This Bill:</span> <span>{formatPayable(invoice.totalAmountPaise)}</span></div>
              <div className="flex justify-between font-bold border-t border-black mt-1 pt-1">
                <span>New Bal:</span> <span>{formatRupees(invoice.newBalancePaise || 0)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-xs mt-2">
          <p>Thank you for your business!</p>
          {invoice.status === 'VOID' && <p className="text-red-500 font-bold mt-2">CANCELLED BILL</p>}
        </div>
      </div>
    </div>
  );
}
