import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Customer } from '../../domain/types';
import { getCustomers, addCustomer } from '../../data/mockApi';
import { validateNewCustomer } from '../../domain/customers';
import { ArrowLeft, Check } from 'lucide-react';

export default function CustomerAdd() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [shopName, setShopName] = useState('');
  const [area, setArea] = useState('');
  const [creditLimitStr, setCreditLimitStr] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    getCustomers().then(setCustomers);
  }, []);

  const handleSave = async () => {
    setErrorMsg('');
    const newCust: Partial<Customer> = { name, mobile };
    
    const err = validateNewCustomer(newCust);
    if (err) {
      setErrorMsg(err);
      return;
    }

    const exists = customers.find(c => c.mobile === mobile);
    if (exists) {
      setErrorMsg('Customer with this mobile already exists.');
      return;
    }

    const id = `cust-${Date.now()}`;
    const limit = parseFloat(creditLimitStr);
    
    const fullCustomer: Customer = {
      id,
      name,
      mobile,
      shopName: shopName || undefined,
      area: area || undefined,
      creditLimitPaise: isNaN(limit) ? undefined : limit * 100,
      outstandingBalancePaise: 0
    };

    await addCustomer(fullCustomer);
    navigate(`/sell/${id}`, { replace: true });
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950 pb-40">
      <div className="bg-white dark:bg-gray-900 shadow-sm px-4 py-3 flex items-center sticky top-0 z-40">
        <button aria-label="Go back" onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold ml-2">Add Customer</h2>
      </div>

      <div className="p-4 space-y-4">
        {errorMsg && (
          <div className="bg-red-100 text-red-700 p-3 rounded-xl text-sm font-bold">
            {errorMsg}
          </div>
        )}

        <div>
          <label htmlFor="ui-field-1" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Name *</label>
          <input id="ui-field-1"
            type="text" value={name} onChange={e => setName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-lg"
            placeholder="E.g. Ramesh Kumar"
          />
        </div>

        <div>
          <label htmlFor="ui-field-2" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Mobile * (10 digits)</label>
          <input id="ui-field-2"
            type="tel" value={mobile} onChange={e => setMobile(e.target.value)} maxLength={10}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-lg"
            placeholder="9876543210"
          />
        </div>

        <div>
          <label htmlFor="ui-field-3" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Shop Name (Optional)</label>
          <input id="ui-field-3"
            type="text" value={shopName} onChange={e => setShopName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-lg"
            placeholder="E.g. Ramesh Kirana"
          />
        </div>

        <div>
          <label htmlFor="ui-field-4" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Area (Optional)</label>
          <input id="ui-field-4"
            type="text" value={area} onChange={e => setArea(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-lg"
            placeholder="E.g. Station Road"
          />
        </div>

        <div>
          <label htmlFor="ui-field-5" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Credit Limit (₹) (Optional)</label>
          <input id="ui-field-5"
            type="number" value={creditLimitStr} onChange={e => setCreditLimitStr(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-lg"
            placeholder="Leave empty for unlimited"
          />
        </div>

      </div>

      <div className="ui-actions p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 z-40">
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl text-lg flex items-center justify-center space-x-2 active:opacity-90 transition-transform"
        >
          <Check size={20} />
          <span>Save & Continue</span>
        </button>
      </div>
    </div>
  );
}
