import { Invoice } from '../../domain/types';
import { formatRupees } from '../../domain/money';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';

export default function InvoicesView({ invoices }: { invoices: Invoice[] }) {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-3">
      {invoices.slice().reverse().map(invoice => {
        const isActive = invoice.status === 'VALID';
        return (
          <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }}
            key={invoice.id} 
            onClick={() => navigate(`/print/${invoice.id}`)}
            className={`p-4 rounded-xl shadow-sm border cursor-pointer active:scale-95 transition-transform ${isActive ? 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700' : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 opacity-70'}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <h4 className={`font-bold flex items-center space-x-2 ${isActive ? '' : 'line-through text-gray-500'}`}>
                  <span>{invoice.invoiceNumber}</span>
                  {!isActive && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded ml-2">VOID</span>}
                </h4>
                <p className="text-sm font-medium mt-1 text-gray-700 dark:text-gray-300">{invoice.customerName || invoice.outletId}</p>
                <div className="flex items-center text-xs text-gray-500 mt-1">
                  <Clock size={12} className="mr-1" />
                  {new Date(invoice.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <p className={`font-bold ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-500 line-through'}`}>
                  {formatRupees(invoice.totalAmountPaise)}
                </p>
                <span className="text-[10px] font-bold text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded inline-block mt-1">{invoice.paymentMode}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
