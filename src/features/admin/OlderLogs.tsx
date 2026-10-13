import { useState } from 'react';
import { useApi } from '../auth/useApi';

export default function OlderLogs({ url, rows, onRows }: { url: string; rows: any[]; onRows: (rows: any[]) => void }) {
  const fetchApi = useApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const last = rows[rows.length - 1];
  if (!last) return null;
  return <div className="p-3"><button disabled={loading} onClick={async () => {
    setLoading(true); setError('');
    try {
      const cursor = new URLSearchParams({ before: String(last.timestamp), beforeId: last.id });
      const response = await fetchApi(`${url}?${cursor}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error('Could not load older records.');
      if (!data.length) setError('No older records.');
      else onRows([...rows, ...data]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load records.'); }
    finally { setLoading(false); }
  }}>{loading ? 'Loading...' : 'Load older records'}</button>{error && <p role="status">{error}</p>}</div>;
}
