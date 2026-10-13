import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../auth/useApi';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

export default function TaxSettings() {
  const fetchApi = useApi();
  const [cgst, setCgst] = useState(0);
  const [sgst, setSgst] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetchApi(`${API_URL}/admin/settings/tax`);
      const data = await res.json();
      setCgst(data.cgst || 0);
      setSgst(data.sgst || 0);
    } catch (e) {
      setMessage('Error loading settings');
    } finally {
      setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleSave = async () => {
    try {
      await fetchApi(`${API_URL}/admin/settings/tax`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cgst, sgst })
      });
      setMessage('Tax settings updated successfully');
    } catch (e: any) {
      setMessage('Error updating: ' + e.message);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="ui-card bg-white dark:bg-gray-800 p-6 rounded shadow max-w-md">
      <h2 className="text-xl font-bold mb-4">Tax Configuration (Admin)</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="ui-field-1" className="block text-sm">CGST %</label>
          <input id="ui-field-1" type="number" step="0.01" value={cgst} onChange={e => setCgst(Number(e.target.value))} className="w-full p-2 border rounded text-black bg-white" />
        </div>
        <div>
          <label htmlFor="ui-field-2" className="block text-sm">SGST %</label>
          <input id="ui-field-2" type="number" step="0.01" value={sgst} onChange={e => setSgst(Number(e.target.value))} className="w-full p-2 border rounded text-black bg-white" />
        </div>
        <button onClick={handleSave} className="w-full bg-blue-600 text-white p-2 rounded">Save Tax Rates</button>
        {message && <p className="text-sm text-center">{message}</p>}
      </div>
    </div>
  );
}
