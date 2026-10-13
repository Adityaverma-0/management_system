import OlderLogs from './OlderLogs';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../auth/useApi';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

export default function AuditLog() {
  const fetchApi = useApi();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetchApi(`${API_URL}/admin/audit`);
      if (!res.ok) throw new Error('Failed to load audit logs');
      const data = await res.json();
      setLogs(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="p-4 dark:text-white">Loading audit logs...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4 dark:text-white">Audit Log</h2>
      <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="ui-table-scroll"><table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
            <tr>
              <th className="px-6 py-3 font-medium">Date & Time</th>
              <th className="px-6 py-3 font-medium">Admin</th>
              <th className="px-6 py-3 font-medium">Action</th>
              <th className="px-6 py-3 font-medium">Entity</th>
              <th className="px-6 py-3 font-medium">Entity ID</th>
              <th className="px-6 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {logs.map((log) => (
              <tr key={log.id} className="dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-6 py-4">{new Date(Number(log.timestamp)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                <td className="px-6 py-4">{log.details?.actor_id || log.admin_username || 'Not recorded'}</td>
                <td className="px-6 py-4 font-semibold">{log.action}</td>
                <td className="px-6 py-4">{log.entity}</td>
                <td className="px-6 py-4">{log.entity_id || log.entity || '—'}</td>
                <td className="px-6 py-4 truncate max-w-xs" title={JSON.stringify(log.details)}>{JSON.stringify(log.details)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
          <OlderLogs url={`${API_URL}/admin/audit`} rows={logs} onRows={setLogs} />
        {logs.length === 0 && <div className="p-6 text-center text-gray-500">No audit logs found.</div>}
      </div>
    </div>
  );
}
