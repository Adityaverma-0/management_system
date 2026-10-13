import SalesCharts from './SalesCharts';
import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../auth/useApi';
import { formatRupees } from '../../domain/money';
import { formatDateTimeIST } from '../../domain/dates';
import { Calendar, TrendingUp, Users, ShoppingCart, IndianRupee } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

export default function SalesDashboard() {
  const fetchApi = useApi();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [period, setPeriod] = useState<'today'|'week'|'month'>('today');
  const [customDate, setCustomDate] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (customDate) params.set('date', customDate);
      else params.set('period', period);
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await fetchApi(`${API_URL}/admin/sales${query}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch sales data');
      setData(await res.json());
      setError('');
    } catch (e: any) {
      setError(e.message || 'Could not load sales dashboard.');
    } finally {
      setLoading(false);
    }
  }, [fetchApi, period, customDate]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  return (
    <div className="space-y-6 text-gray-900 dark:text-gray-100 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="text-blue-500" />
          Sales Dashboard
        </h2>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button 
              onClick={() => { setPeriod('today'); setCustomDate(''); }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${period === 'today' && !customDate ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >Today</button>
            <button 
              onClick={() => { setPeriod('week'); setCustomDate(''); }}
              className={`px-4 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700 transition-colors ${period === 'week' && !customDate ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >This Week</button>
            <button 
              onClick={() => { setPeriod('month'); setCustomDate(''); }}
              className={`px-4 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700 transition-colors ${period === 'month' && !customDate ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >This Month</button>
          </div>
          
          <div className="flex items-center bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 px-3 py-1.5 focus-within:ring-2 ring-blue-500">
            <Calendar size={16} className="text-gray-400 mr-2" />
            <input 
              type="date" 
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                if (e.target.value) setPeriod('today'); // customDate takes precedence
              }}
              className="bg-transparent border-none outline-none text-sm dark:text-white"
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-200 dark:border-red-800 flex items-center justify-between">
          <p>{error}</p>
          <button onClick={loadDashboard} className="px-3 py-1 bg-red-100 dark:bg-red-900/50 rounded hover:bg-red-200 dark:hover:bg-red-900/70">Retry</button>
        </div>
      ) : loading && !data ? (
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="bg-white dark:bg-gray-800 h-28 rounded-xl opacity-50 shadow-sm border border-gray-100 dark:border-gray-700" />)}
          </div>
          <div className="bg-white dark:bg-gray-800 h-64 rounded-xl opacity-50 shadow-sm border border-gray-100 dark:border-gray-700" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-500 dark:text-gray-400 text-sm font-bold tracking-wide">TOTAL SALES</h3>
                <div className="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg text-blue-600 dark:text-blue-400"><IndianRupee size={20} /></div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatRupees(data.stats.totalSales)}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-500 dark:text-gray-400 text-sm font-bold tracking-wide">ORDERS</h3>
                <div className="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg text-green-600 dark:text-green-400"><ShoppingCart size={20} /></div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{data.stats.totalOrders}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-500 dark:text-gray-400 text-sm font-bold tracking-wide">CUSTOMERS</h3>
                <div className="bg-purple-50 dark:bg-purple-900/30 p-2 rounded-lg text-purple-600 dark:text-purple-400"><Users size={20} /></div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{data.stats.uniqueCustomers}</p>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-gray-500 dark:text-gray-400 text-sm font-bold tracking-wide">AVG ORDER VALUE</h3>
                <div className="bg-orange-50 dark:bg-orange-900/30 p-2 rounded-lg text-orange-600 dark:text-orange-400"><TrendingUp size={20} /></div>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatRupees(data.stats.avgOrderValue)}</p>
            </div>
          </div>

          {data.analytics && <SalesCharts data={data.analytics} />}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mt-6">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h3 className="font-bold text-lg">
                Related Orders 
                <span className="ml-2 text-sm font-normal text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{data.invoices.length}</span>
              </h3>
            </div>
            
            {data.invoices.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                <ShoppingCart className="mx-auto mb-3 opacity-20" size={48} />
                <p>No orders found for this period.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs uppercase bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 sticky top-0 z-10 box-border border-b dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Reference</th>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.invoices.map((inv: any) => (
                      <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                          {formatDateTimeIST(inv.created_at).split(', ')[1]}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {inv.invoice_number}
                        </td>
                        <td className="px-4 py-3">
                          {inv.customer_name || 'Walk-in'}
                        </td>
                        <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">
                          {formatRupees(inv.total_amount_paise)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            inv.payment_mode === 'CASH' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                            inv.payment_mode === 'UPI' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
                            'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
                          }`}>
                            {inv.payment_mode}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
