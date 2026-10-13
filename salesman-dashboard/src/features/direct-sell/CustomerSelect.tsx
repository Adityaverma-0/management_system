import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Customer } from '../../domain/types';
import { getCustomers, fetchActiveWorkDay } from '../../data/mockApi';
import { getRecentCustomers } from '../../domain/customers';
import { formatRupees } from '../../domain/money';
import { Search, UserPlus, ArrowLeft, User, MapPin, Phone } from 'lucide-react';

export default function CustomerSelect() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    getCustomers().then(data => {
      setCustomers(data.sort((a, b) => a.name.localeCompare(b.name)));
      setIsReady(true);
    }).catch(e => setError(e.message));
    
    // Check day state
    fetchActiveWorkDay().then(s => {
      if (s.state !== 'ON_ROUTE') {
        alert('You must be ON_ROUTE to perform a Direct Sell.');
        navigate(-1);
      }
    }).catch(e => setError(e.message));
  }, [navigate]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const recent = useMemo(() => getRecentCustomers(customers), [customers]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return [];
    const lower = debouncedSearch.toLowerCase();
    
    // Check by mobile
    const byMobile = customers.filter(c => c.mobile.includes(lower));
    if (byMobile.length > 0 && /^\d+$/.test(lower)) return byMobile;

    // Binary search by name prefix
    let left = 0, right = customers.length - 1, startIdx = -1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const name = customers[mid].name.toLowerCase();
      if (name.startsWith(lower)) {
        startIdx = mid;
        right = mid - 1; 
      } else if (name < lower) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    if (startIdx !== -1) {
      const matches = [];
      for (let i = startIdx; i < customers.length; i++) {
        if (customers[i].name.toLowerCase().startsWith(lower)) {
          matches.push(customers[i]);
        } else break;
      }
      return matches.slice(0, 20); // max 20
    }
    
    // Substring fallback
    return customers.filter(c => 
      c.name.toLowerCase().includes(lower) || 
      (c.shopName && c.shopName.toLowerCase().includes(lower))
    ).slice(0, 20);
  }, [debouncedSearch, customers]);

  if (error) return <div role="alert" className="p-4">{error}<button onClick={() => window.location.reload()}>Retry</button></div>;
  if (!isReady) return <div className="p-4">Loading...</div>;

  const displayList = debouncedSearch ? filtered : recent;

  return (
    <div className="flex flex-col ui-workflow bg-gray-50 dark:bg-gray-950">
      <div className="bg-white dark:bg-gray-900 shadow-sm px-4 py-3 flex items-center sticky top-0 z-40">
        <button aria-label="Go back" onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold ml-2">Select Customer</h2>
      </div>

      <div className="p-4">
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={20} className="text-gray-400" />
          </div>
          <input aria-label="Name, Shop or Mobile..."
            type="text"
            placeholder="Name, Shop or Mobile..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-lg"
          />
        </div>

        <div className="flex space-x-2 mb-6">
          <button 
            onClick={() => navigate('/sell/walk-in')}
            className="flex-1 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-3 rounded-xl flex items-center justify-center space-x-2"
          >
            <User size={18} />
            <span>Walk-in (Cash/UPI)</span>
          </button>
          <button 
            onClick={() => navigate('/sell/new-customer')}
            className="flex-1 bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-bold py-3 rounded-xl flex items-center justify-center space-x-2"
          >
            <UserPlus size={18} />
            <span>New Customer</span>
          </button>
        </div>

        <h3 className="text-sm font-bold text-gray-500 uppercase mb-3 px-1">
          {debouncedSearch ? 'Search Results' : 'Recent Customers'}
        </h3>

        <div className="space-y-3">
          {displayList.map(c => (
            <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }}
              key={c.id} 
              onClick={() => navigate(`/sell/${c.id}`)}
              className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer hover:border-blue-500 transition-colors active:opacity-90"
            >
              <div className="flex justify-between items-start mb-1">
                <h4 className="font-bold text-lg" onClick={() => navigate(`/sell/${c.id}`)}>{c.name}</h4>
                <div className="flex space-x-3 items-center">
                  {c.outstandingBalancePaise > 0 && (
                    <span className="text-red-600 font-bold text-sm bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                      Dues: {formatRupees(c.outstandingBalancePaise)}
                    </span>
                  )}
                  <button 
                    onClick={(e) => { e.stopPropagation(); navigate(`/customer/${c.id}`); }}
                    className="p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-blue-600 rounded-lg active:opacity-90"
                  >
                    <User size={18} />
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-500 flex flex-col space-y-1">
                {c.shopName && <div className="flex items-center"><User size={14} className="mr-1"/> {c.shopName}</div>}
                <div className="flex items-center"><Phone size={14} className="mr-1"/> {c.mobile}</div>
                {c.area && <div className="flex items-center"><MapPin size={14} className="mr-1"/> {c.area}</div>}
              </div>
            </div>
          ))}
          {displayList.length === 0 && (
            <div className="text-center p-8 text-gray-500">
              No customers found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
