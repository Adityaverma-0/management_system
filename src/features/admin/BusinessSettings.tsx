import { useEffect, useState } from 'react';
import { useApi } from '../auth/useApi';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
type Settings = { businessName: string; gstin: string; fallbackBusinessName: string };

export default function BusinessSettings() {
  const fetchApi = useApi();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [gstin, setGstin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void fetchApi(`${API_URL}/settings/business`).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load business settings.');
      if (active) { setSaved(data); setBusinessName(data.businessName); setGstin(data.gstin); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [fetchApi]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    const normalizedGstin = gstin.trim().toUpperCase();
    if (normalizedGstin && !GSTIN_PATTERN.test(normalizedGstin)) {
      setError('Enter a valid 15-character GSTIN (for example 27ABCDE1234F1Z5).'); return;
    }
    setBusy(true);
    try {
      const response = await fetchApi(`${API_URL}/admin/settings/business`, {
        method: 'PUT', body: JSON.stringify({ businessName: businessName.trim(), gstin: normalizedGstin })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save business settings.');
      setSaved(data); setBusinessName(data.businessName); setGstin(data.gstin);
      window.dispatchEvent(new Event('business-settings-updated'));
      setMessage('Saved. New bills will use these settings. Existing bills retain their saved details.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save business settings.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-xl font-bold dark:text-white">Business Settings</h2>
      {error && <p role="alert" className="p-3 rounded bg-red-50 text-red-700">{error}</p>}
      {saved && !saved.businessName && <p role="alert" className="p-3 rounded bg-amber-50 text-amber-800">Business name is not set. Bills will show “{saved.fallbackBusinessName}”.</p>}
      {saved && !saved.gstin && <p role="alert" className="p-3 rounded bg-amber-50 text-amber-800">GST number is not set. Bills will show “GSTIN: Not configured”.</p>}
      {message && <p role="status" className="p-3 rounded bg-green-50 text-green-700">{message}</p>}
      {!saved ? <p>{error ? 'Reload this page to retry.' : 'Loading business settings...'}</p> : (
        <form onSubmit={save} className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm space-y-4">
          <label className="block text-sm font-medium">Business Name
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} maxLength={255} className="block w-full mt-1 p-2 border rounded bg-white dark:bg-gray-900" />
          </label>
          <label className="block text-sm font-medium">GST Number
            <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15} autoCapitalize="characters" spellCheck={false} placeholder="27ABCDE1234F1Z5" className="block w-full mt-1 p-2 border rounded bg-white dark:bg-gray-900" />
          </label>
          <button disabled={busy} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">{busy ? 'Saving...' : 'Save Settings'}</button>
        </form>
      )}
    </div>
  );
}
