import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { request } from '../data/apiClient';

function formatDateTimeIST(val: unknown): string {
  if (val === null || val === undefined || val === '') return 'N/A';
  const n = Number(val);
  const ms = !isNaN(n) ? (n < 1e12 ? n * 1000 : n) : new Date(String(val)).getTime();
  const d = new Date(ms);
  if (isNaN(d.getTime())) return 'Invalid Date';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export default function StockRequests() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const data = await request('/salesman/stock-requests');
        setRequests(data);
      } catch (e) {
        console.error('Failed to fetch requests', e);
      } finally {
        setLoading(false);
      }
    };
    fetchRequests();
  }, []);

  if (loading) return <div className="p-4">Loading requests...</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center space-x-4 mb-4">
        <button aria-label="Go back" onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-bold">Stock Requests</h2>
      </div>

      {requests.length === 0 ? <p className="text-gray-500">No requests.</p> :
        requests.map((req: any) => (
          <div key={req.id} className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex justify-between">
              <span className="font-bold">{formatDateTimeIST(req.requestedAt)}</span>
              <span className={`px-2 py-1 rounded text-xs font-bold ${
                req.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                req.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                'bg-amber-100 text-amber-800'
              }`}>{req.status}</span>
            </div>
            <div className="text-sm mt-2">{req.items.length} items</div>
            {req.adminNote && <div className="text-sm text-red-600 mt-1">Admin note: {req.adminNote}</div>}
          </div>
        ))
      }
    </div>
  );
}
