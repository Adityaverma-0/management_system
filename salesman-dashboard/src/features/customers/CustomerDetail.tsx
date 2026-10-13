import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Customer, Invoice } from '../../domain/types';
import { getCustomers, getInvoices } from '../../data/mockApi';
import { formatRupees } from '../../domain/money';
import { ArrowLeft, User, Phone, MapPin, Receipt, Clock } from 'lucide-react';

export default function CustomerDetail() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bills, setBills] = useState<Invoice[]>([]);

  useEffect(() => {
    getCustomers().then(custs => {
      const c = custs.find(c => c.id === customerId);
      if (c) setCustomer(c);
    });
    getInvoices().then(invs => {
      const b = invs.filter(i => i.customerId === customerId).sort((a, b) => b.createdAt - a.createdAt);
      setBills(b);
    });
  }, [customerId]);

  if (!customer) return <div className="p-4">Loading...</div>;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950 pb-24">
      <div className="bg-white dark:bg-gray-900 shadow-sm px-4 py-3 flex items-center sticky top-0 z-40">
        <button aria-label="Go back" onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold ml-2">Customer Profile</h2>
      </div>

      <div className="p-4 space-y-4">
        <div className="ui-card bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full mx-auto flex items-center justify-center mb-3">
            <User size={32} />
          </div>
          <h3 className="font-bold text-2xl">{customer.name}</h3>
          <p className="text-gray-500 font-bold mb-4">{customer.shopName}</p>
          
          <div className="flex flex-wrap justify-center gap-3 text-sm text-gray-600 dark:text-gray-400 mb-6">
            <div className="flex items-center"><Phone size={16} className="mr-1"/> {customer.mobile}</div>
            {customer.area && <div className="flex items-center"><MapPin size={16} className="mr-1"/> {customer.area}</div>}
          </div>

          <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-100 dark:border-orange-900/30">
            <p className="text-orange-800 dark:text-orange-300 font-bold text-sm mb-1">Outstanding Balance</p>
            <p className="text-3xl font-bold text-orange-600">{formatRupees(customer.outstandingBalancePaise)}</p>
            {customer.creditLimitPaise !== undefined && (
              <p className="text-xs text-orange-600/70 mt-1 font-bold">Limit: {formatRupees(customer.creditLimitPaise)}</p>
            )}
          </div>
        </div>

        <h3 className="text-lg font-bold px-1 mt-6 flex items-center">
          <Receipt className="mr-2" /> Recent Bills
        </h3>

        <div className="space-y-3">
          {bills.map(bill => (
            <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} key={bill.id} onClick={() => navigate(`/print/${bill.id}`)} className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex justify-between items-center cursor-pointer active:opacity-90 transition-transform">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <span className="font-bold">{bill.invoiceNumber}</span>
                  {bill.status === 'VOID' && <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded">VOID</span>}
                </div>
                <div className="flex items-center text-xs text-gray-500">
                  <Clock size={12} className="mr-1" />
                  {new Date(bill.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-lg">{formatRupees(bill.totalAmountPaise)}</div>
                <div className="text-xs font-bold text-gray-500">{bill.paymentMode || 'CASH'}</div>
              </div>
            </div>
          ))}
          {bills.length === 0 && (
            <div className="text-center p-8 text-gray-500 font-bold">
              No bills found for this customer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
