import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../auth/useApi';
import { ArrowLeft, CheckCircle, RotateCcw, XCircle, Package } from 'lucide-react';
import { formatDateTimeIST } from '../../domain/dates';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

interface StockRequestItem {
  productId: string;
  productName: string;
  quantityPieces: number;
  unitsPerStrip?: number;
  piecesPerBox?: number;
  boxes?: number;
  strips?: number;
  pieces?: number;
}

interface StockRequest {
  id: string;
  workDayId: string;
  salesmanId: string;
  salesmanName?: string;
  vehicleId: string;
  vehicleName?: string;
  godownId: string;
  godownName?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  items: StockRequestItem[];
  requestedAt: number;
  processedAt?: number;
  adminNote?: string;
}


  const handleDownloadReport = (req: StockRequest) => {
    const lines = [
      `STOCK APPROVAL REQUEST REPORT`,
      `Request ID: ${req.id}`,
      `Salesman: ${req.salesmanName || req.salesmanId}`,
      `Vehicle: ${req.vehicleName || req.vehicleId}`,
      `Godown: ${req.godownName || req.godownId}`,
      `Status: ${req.status}`,
      `Submitted: ${formatDateTimeIST(req.requestedAt)}`,
      req.processedAt ? `Processed: ${formatDateTimeIST(req.processedAt)}` : '',
      req.adminNote ? `Admin Note: ${req.adminNote}` : '',
      `----------------------------------------`,
      `REQUESTED ITEMS (${req.items.length}):`,
      ...req.items.map(i => `- ${i.productName || i.productId}: ${formatItemBreakdown(i)}`)
    ].filter(Boolean);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Stock_Approval_${req.id.slice(0, 8)}.txt');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintReport = () => {
    window.print();
  };

export default function StockApprovalDashboard() {
  const fetchApi = useApi();
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedReq, setSelectedReq] = useState<StockRequest | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchApi(`${API_URL}/admin/stock-requests`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch stock requests');
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
      setError('');
    } catch (err: any) {
      console.error('Failed to load stock requests', err);
      setError(err instanceof Error ? err.message : 'Could not load stock requests.');
    } finally {
      setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const pendingRequests = useMemo(
    () => requests.filter(r => r.status === 'PENDING'),
    [requests]
  );
  const approvedRequests = useMemo(
    () => requests.filter(r => r.status === 'APPROVED'),
    [requests]
  );

  const handleApprove = async (req: StockRequest) => {
    if (!window.confirm(`Approve stock request for ${req.salesmanName || req.salesmanId} (${req.items.length} items)?`)) return;
    setBusyId(req.id);
    setError('');
    try {
      const res = await fetchApi(`${API_URL}/admin/stock-requests/${req.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve stock request');
      await refresh();
      setSelectedReq(null);
    } catch (err: any) {
      console.error('Approval error:', err);
      setError(err instanceof Error ? err.message : 'Could not approve stock request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: StockRequest) => {
    const note = window.prompt('Reason for rejecting this stock request:');
    if (note === null) return;
    if (!note.trim()) {
      alert('A reason is required to reject a stock request.');
      return;
    }
    setBusyId(req.id);
    setError('');
    try {
      const res = await fetchApi(`${API_URL}/admin/stock-requests/${req.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject stock request');
      await refresh();
      setSelectedReq(null);
    } catch (err: any) {
      console.error('Rejection error:', err);
      setError(err instanceof Error ? err.message : 'Could not reject stock request.');
    } finally {
      setBusyId(null);
    }
  };

  const formatItemBreakdown = (item: StockRequestItem) => {
    const parts: string[] = [];
    if (item.boxes) parts.push(`${item.boxes} box${item.boxes > 1 ? 'es' : ''}`);
    if (item.strips) parts.push(`${item.strips} strip${item.strips > 1 ? 's' : ''}`);
    if (item.pieces) parts.push(`${item.pieces} pc${item.pieces > 1 ? 's' : ''}`);
    if (parts.length > 0) return `${item.quantityPieces} pcs (${parts.join(', ')})`;
    return `${item.quantityPieces} pcs`;
  };

  if (loading) return <div className="p-4 text-gray-500">Loading stock requests...</div>;

  if (selectedReq) {
    const req = selectedReq;
    const isBusy = busyId === req.id;
    const isPending = req.status === 'PENDING';

    return (
      <div className="w-full max-w-none space-y-6 p-4 text-sm text-gray-900 dark:text-gray-100">
        <div className="flex items-center gap-3">
          <button aria-label="Go back" onClick={() => setSelectedReq(null)} className="rounded-full p-2 hover:bg-gray-200 dark:hover:bg-gray-800">
            <ArrowLeft size={22} />
          </button>
          <h2 className="text-xl font-bold">Stock Request Detail</h2>
        </div>

        {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}

        <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left border-collapse bg-white dark:bg-gray-900">
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              <tr>
                <th className="p-2 bg-gray-50 dark:bg-gray-800 w-1/3">Salesman</th>
                <td className="p-2 font-bold">{req.salesmanName || req.salesmanId}</td>
              </tr>
              <tr>
                <th className="p-2 bg-gray-50 dark:bg-gray-800">Vehicle</th>
                <td className="p-2">{req.vehicleName || req.vehicleId}</td>
              </tr>
              <tr>
                <th className="p-2 bg-gray-50 dark:bg-gray-800">Warehouse (Godown)</th>
                <td className="p-2">{req.godownName || req.godownId}</td>
              </tr>
              <tr>
                <th className="p-2 bg-gray-50 dark:bg-gray-800">Status</th>
                <td className="p-2">
                  <span className={`font-bold px-2 py-0.5 rounded text-xs ${
                    req.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                    req.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                    'bg-amber-100 text-amber-800'
                  }`}>
                    {req.status}
                  </span>
                </td>
              </tr>
              <tr>
                <th className="p-2 bg-gray-50 dark:bg-gray-800">Submitted Time</th>
                <td className="p-2">{formatDateTimeIST(req.requestedAt)}</td>
              </tr>
              {req.adminNote && (
                <tr>
                  <th className="p-2 bg-gray-50 dark:bg-gray-800">Admin Note</th>
                  <td className="p-2 text-red-600 dark:text-red-400 font-medium">{req.adminNote}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="font-bold text-base mb-2 flex items-center gap-2">
            <Package size={18} /> Requested Products ({req.items.length})
          </h3>
          <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left border-collapse bg-white dark:bg-gray-900">
              <thead className="bg-gray-50 dark:bg-gray-800 uppercase text-xs text-gray-500">
                <tr>
                  <th className="p-2 border-b dark:border-gray-700">#</th>
                  <th className="p-2 border-b dark:border-gray-700">Product Name</th>
                  <th className="p-2 border-b dark:border-gray-700 text-right">Requested Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {req.items.map((item, idx) => (
                  <tr key={item.productId || idx}>
                    <td className="p-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="p-2 font-medium">{item.productName || item.productId}</td>
                    <td className="p-2 text-right font-bold">{formatItemBreakdown(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {isPending && (
          <div className="flex gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
            <button
              disabled={isBusy}
              onClick={() => void handleApprove(req)}
              className="flex-1 rounded bg-green-600 p-3 font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-green-700"
            >
              <CheckCircle size={20} /> Approve & Allocate
            </button>
            <button
              disabled={isBusy}
              onClick={() => void handleReject(req)}
              className="flex-1 rounded border border-red-300 p-3 font-bold text-red-600 dark:border-red-800 dark:text-red-400 disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <XCircle size={20} /> Reject Request
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Stock Approvals</h2>
        <button
          onClick={() => void refresh()}
          className="flex items-center gap-2 rounded bg-white dark:bg-gray-800 px-3 py-2 text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
        >
          <RotateCcw size={16} /> Refresh
        </button>
      </div>

      {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-amber-200 bg-amber-50 p-4 dark:bg-amber-900/20 dark:border-amber-800/50">
          <div className="font-bold text-amber-800 dark:text-amber-400">Pending Review</div>
          <div className="text-3xl font-bold text-amber-900 dark:text-amber-300">{pendingRequests.length}</div>
        </div>
        <div className="rounded border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800/50">
          <div className="font-bold text-green-800 dark:text-green-400">Approved</div>
          <div className="text-3xl font-bold text-green-900 dark:text-green-300">{approvedRequests.length}</div>
        </div>
      </div>

      <div className="space-y-3">
        {requests.map(req => (
          <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }}
            key={req.id}
            onClick={() => setSelectedReq(req)}
            className="ui-card cursor-pointer rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-500 transition-colors"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">{req.salesmanName || req.salesmanId}</h3>
                <div className="text-xs text-gray-500">Vehicle: {req.vehicleName || req.vehicleId} | Warehouse: {req.godownName || req.godownId}</div>
                <div className="text-sm text-gray-500 mt-1">{formatDateTimeIST(req.requestedAt)}</div>
                <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1">
                  {req.items.length} item{req.items.length > 1 ? 's' : ''} requested ({req.items.reduce((s, i) => s + i.quantityPieces, 0)} total pcs)
                </div>
              </div>
              <div className={`font-bold px-2 py-1 rounded text-xs ${
                req.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                req.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                'bg-amber-100 text-amber-800'
              }`}>
                {req.status}
              </div>
            </div>
          </div>
        ))}
        {requests.length === 0 && <div className="text-center p-8 text-gray-500">No stock requests found</div>}
      </div>
    </div>
  );
}
