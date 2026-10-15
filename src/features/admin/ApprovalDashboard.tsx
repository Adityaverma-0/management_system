import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { subscribeDayUpdates } from '../auth/dayUpdates';
import { useApi } from '../auth/useApi';
import { ArrowLeft, CheckCircle, RotateCcw, XCircle } from 'lucide-react';
import { formatRupees } from '../../domain/money';
import { formatDateTimeIST, formatCalendarDateIST } from '../../domain/dates';
import StockSummaryTable from '../stock/StockSummaryTable';
import CashBreakdownTable from '../CashBreakdownTable';


const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

export default function ApprovalDashboard() {
  const fetchApi = useApi();
  const { token } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [salesmen, setSalesmen] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyDayId, setBusyDayId] = useState('');
  const refreshVersion = useRef(0);
  const [selectedReq, setSelectedReq] = useState<any>(null);

  const getSalesmanName = useCallback((id: string) => {
    const row = salesmen.find(s => s.id === id);
    return row ? row.name : id;
  }, [salesmen]);
  const getVehicleName = useCallback((id: string) => {
    const row = vehicles.find(v => v.id === id);
    return row ? row.name : id;
  }, [vehicles]);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const res = await fetchApi(`${API_URL}/unload-requests`, {  });
      if (!res.ok) throw new Error('Failed to fetch from backend');
      const data = await res.json();
      if (version !== refreshVersion.current) return;
      const next = Array.isArray(data) ? data.map((d: any) => ({ ...d, requestData: d.request_data || d.requestData })) : [];
      setRequests(next);
      setSelectedReq((current: any) => current ? next.find((row: any) => row.id === current.id) || null : null);
      // WHY: names are now fetched from the master tables; id is only a fallback.
      try {
        const [sRes, vRes] = await Promise.all([fetchApi(`${API_URL}/admin/salesmen`), fetchApi(`${API_URL}/admin/vehicles`)]);
        const [people, vans] = await Promise.all([sRes.json(), vRes.json()]);
        if (version !== refreshVersion.current) return;
        setSalesmen(people); setVehicles(vans);
      } catch { /* keep empty maps; id will show as fallback */ }
      setError('');
    } catch (loadError) {
      console.error('Failed to load admin approval dashboard', loadError);
      if (version !== refreshVersion.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Could not load workday submissions.');
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    void refresh();
    const unsubscribe = token ? subscribeDayUpdates(API_URL, token, () => void refresh()) : () => {};
    const interval = window.setInterval(() => void refresh(), 10000);
    window.addEventListener('focus', refresh);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh, token]);

  const pendingRequests = useMemo(
    () => requests.filter(req => req.status === 'PENDING' || req.status === 'SENT_BACK'),
    [requests]
  );

  const handleApprove = async (reqObj: any) => {
    const day = reqObj.requestData;
    const totals = day.paymentTotals || { total: 0, cash: 0, upi: 0, credit: 0 };
    if (day.cashCollected !== totals.cash) {
      alert("Cannot approve: Cash collected does not match Cash sales.");
      return;
    }
    if (!window.confirm(`Approve ${day.salesmanId}'s end-of-day report?`)) return;
    setBusyDayId(reqObj.id);
    setError('');
    try {
      const res = await fetchApi(`${API_URL}/unload-requests/${reqObj.id}/approve`, { method: 'POST'});
      if (!res.ok) throw new Error('Backend approval failed');
      await refresh();
      setSelectedReq(null);
    } catch (actionError) {
      console.error('Failed to approve', actionError);
      setError(actionError instanceof Error ? actionError.message : 'Could not approve this report.');
    } finally {
      setBusyDayId('');
    }
  };

  const handleSendBack = async (reqObj: any) => {
    const note = window.prompt('Tell the salesman what needs to be corrected:');
    if (note === null) return;
    if (!note.trim()) {
      alert('Enter a reason before sending the report back.');
      return;
    }
    setBusyDayId(reqObj.id);
    setError('');
    try {
      const res = await fetchApi(`${API_URL}/unload-requests/${reqObj.id}/send-back`, {
        method: 'POST',

        body: JSON.stringify({ note: note.trim() })
      });
      if (!res.ok) throw new Error('Backend send back failed');
      await refresh();
      setSelectedReq(null);
    } catch (actionError) {
      console.error('Failed to return', actionError);
      setError(actionError instanceof Error ? actionError.message : 'Could not return this report.');
    } finally {
      setBusyDayId('');
    }
  };

  const handleDownloadReport = (reqObj: any) => {
    const day = reqObj.requestData || {};
    const totals = day.paymentTotals || { total: 0, cash: 0, upi: 0, credit: 0 };
    const lines = [
      "UNLOAD APPROVAL END-DAY REPORT",
      `Request ID: ${reqObj.id}`,
      `Salesman: ${getSalesmanName(day.salesmanId)} (${day.salesmanId})`,
      `Vehicle: ${getVehicleName(day.vehicleId)} (${day.vehicleId})`,
      `Date: ${formatCalendarDateIST(day.calendarDate)}`,
      `Status: ${reqObj.status}`,
      `Submitted: ${formatDateTimeIST(reqObj.requestedAt)}`,
      "----------------------------------------",
      `SALES BREAKDOWN:`,
      `Cash: ${formatRupees(totals.cash)}`,
      `UPI: ${formatRupees(totals.upi)}`,
      `Credit: ${formatRupees(totals.credit)}`,
      `Total Sales: ${formatRupees(totals.total)}`,
      `Cash Collected: ${formatRupees(day.cashCollected)}`,
      "----------------------------------------",
      `PRODUCTS (${(day.products || []).length}):`,
      ...(day.products || []).map((p: any) => `- ${p.productName}: Opening=${p.opening}, Loaded=${p.loadedAtStart}, Sold=${p.sold}, Expected=${p.expectedRemaining}, Counted=${p.countedRemaining}, Unload=${p.unloadQty}, Hold=${p.holdQty}`)
    ].filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Unload_Approval_${reqObj.id.slice(0, 8)}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintReport = () => {
    window.print();
  };

  if (loading) return <div className="p-4">Loading approval dashboard...</div>;

  if (selectedReq) {
    const reqObj = selectedReq;
    const isBusy = busyDayId === reqObj.id;
    const day = reqObj.requestData;
    const totals = day.paymentTotals || { total: 0, cash: 0, upi: 0, credit: 0 };
    const billCounts = day.billCounts || { Cash: 0, UPI: 0, Credit: 0 };
    const isPending = reqObj.status === 'PENDING' || reqObj.status === 'SENT_BACK';
    const cashDiff = day.cashCollected - totals.cash;

    return (
      <div className="w-full max-w-none space-y-6 p-4 text-sm text-gray-900 dark:text-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button aria-label="Go back" onClick={() => setSelectedReq(null)} className="rounded-full p-2 hover:bg-gray-200 dark:hover:bg-gray-800">
              <ArrowLeft size={22} />
            </button>
            <h2 className="text-xl font-bold">Request Detail</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleDownloadReport(reqObj)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-bold">
              Download Report
            </button>
            <button onClick={handlePrintReport} className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1.5 rounded text-xs font-bold">
              Print Report
            </button>
          </div>
        </div>

        {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}

        {/* 1. Header table */}
        <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left border-collapse bg-white dark:bg-gray-900">
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              <tr><th className="p-2 bg-gray-50 dark:bg-gray-800 w-1/3">Salesman</th><td className="p-2 font-bold">{getSalesmanName(day.salesmanId)} <span className="text-gray-400 font-normal">({day.salesmanId})</span></td></tr>
              <tr><th className="p-2 bg-gray-50 dark:bg-gray-800">Vehicle & Location</th><td className="p-2">{getVehicleName(day.vehicleId)} <span className="text-gray-400">({day.vehicleId})</span></td></tr>
              <tr><th className="p-2 bg-gray-50 dark:bg-gray-800">Date</th><td className="p-2">{formatCalendarDateIST(day.calendarDate)}</td></tr>
              <tr><th className="p-2 bg-gray-50 dark:bg-gray-800">Status</th><td className="p-2 font-bold uppercase">{reqObj.status}</td></tr>
              <tr><th className="p-2 bg-gray-50 dark:bg-gray-800">Submitted Time</th><td className="p-2">{formatDateTimeIST(reqObj.requestedAt)}</td></tr>
            </tbody>
          </table>
        </div>

        {/* 2. Sales and cash table */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left border-collapse bg-white dark:bg-gray-900">
              <thead className="bg-gray-50 dark:bg-gray-800 uppercase text-xs text-gray-500">
                <tr><th className="p-2 border-b dark:border-gray-700">Mode</th><th className="p-2 border-b dark:border-gray-700 text-right">Sales (Rs)</th><th className="p-2 border-b dark:border-gray-700 text-right">Bills</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                <tr><td className="p-2">Cash</td><td className="p-2 text-right">{formatRupees(totals.cash)}</td><td className="p-2 text-right">{billCounts.Cash}</td></tr>
                <tr><td className="p-2">UPI</td><td className="p-2 text-right">{formatRupees(totals.upi)}</td><td className="p-2 text-right">{billCounts.UPI}</td></tr>
                <tr><td className="p-2">Credit</td><td className="p-2 text-right">{formatRupees(totals.credit)}</td><td className="p-2 text-right">{billCounts.Credit}</td></tr>
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 font-bold">
                <tr><td className="p-2">Total</td><td className="p-2 text-right">{formatRupees(totals.total)}</td><td className="p-2 text-right">{billCounts.Cash+billCounts.UPI+billCounts.Credit}</td></tr>
              </tfoot>
            </table>
          </div>

          <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left border-collapse bg-white dark:bg-gray-900">
              <thead className="bg-gray-50 dark:bg-gray-800 uppercase text-xs text-gray-500">
                <tr><th colSpan={2} className="p-2 border-b dark:border-gray-700">Cash Check</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                <tr><td className="p-2">Expected Cash</td><td className="p-2 font-bold text-right">{formatRupees(totals.cash)}</td></tr>
                <tr><td className="p-2">Cash Received</td><td className="p-2 font-bold text-right">{formatRupees(day.cashCollected)}</td></tr>
                <tr className={cashDiff === 0 ? "text-green-600 dark:text-green-400 font-bold" : "text-red-600 dark:text-red-400 font-bold"}>
                  <td className="p-2 bg-gray-50 dark:bg-gray-800">Difference</td>
                  <td className="p-2 bg-gray-50 dark:bg-gray-800 text-right">
                    {cashDiff === 0 ? 'MATCH' : (cashDiff > 0 ? `EXCESS: ${formatRupees(cashDiff)}` : `SHORT: ${formatRupees(Math.abs(cashDiff))}`)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Cash received table */}
        <div className="ui-card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded">
          <CashBreakdownTable
            breakdown={day.cashDenominationBreakdown || {}}
            totalPaise={day.cashCollected}
            noteCount={Object.entries(day.cashDenominationBreakdown || {}).filter(([key]) => key.startsWith('NOTE_')).reduce((total, [, count]) => total + Number(count), 0)}
            coinCount={Object.entries(day.cashDenominationBreakdown || {}).filter(([key]) => key.startsWith('COIN_')).reduce((total, [, count]) => total + Number(count), 0)}
          />
        </div>

        {/* 4. Stock table */}
        <StockSummaryTable report={day.products || []} isPending={isPending} />

        {/* 5. Action area */}
        {isPending && (
          <div className="flex gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
            <button
              disabled={isBusy || cashDiff !== 0}
              onClick={() => void handleApprove(reqObj)}
              className="flex-1 rounded bg-green-600 p-3 font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <CheckCircle size={20} /> Approve
            </button>
            <button
              disabled={isBusy}
              onClick={() => void handleSendBack(reqObj)}
              className="flex-1 rounded border border-red-300 p-3 font-bold text-red-600 dark:border-red-800 dark:text-red-400 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <XCircle size={20} /> Send Back
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Admin Approvals</h2>
          </div>
        </div>
        <button onClick={() => void refresh()} className="flex items-center gap-2 rounded bg-white dark:bg-gray-800 px-3 py-2 text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
          <RotateCcw size={16} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-amber-200 bg-amber-50 p-4 dark:bg-amber-900/20 dark:border-amber-800/50">
          <div className="font-bold text-amber-800 dark:text-amber-400">Pending Review</div>
          <div className="text-3xl font-bold text-amber-900 dark:text-amber-300">{pendingRequests.filter(req => req.status === 'PENDING').length}</div>
        </div>
        <div className="rounded border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800/50">
          <div className="font-bold text-green-800 dark:text-green-400">Approved</div>
          <div className="text-3xl font-bold text-green-900 dark:text-green-300">{requests.filter(req => req.status === 'APPROVED').length}</div>
        </div>
      </div>

      <div className="space-y-3">
        {requests.map(reqObj => (
          <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} key={reqObj.id} onClick={() => setSelectedReq(reqObj)} className="ui-card cursor-pointer rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-500">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">{getSalesmanName(reqObj.requestData.salesmanId)}</h3>
                <div className="text-xs text-gray-500">{getVehicleName(reqObj.requestData.vehicleId)}</div>
                <div className="text-sm text-gray-500">{formatDateTimeIST(reqObj.requestedAt)}</div>
                <div className="text-xs text-gray-400">Date: {formatCalendarDateIST(reqObj.requestData?.calendarDate)}</div>
              </div>
              <div className={`font-bold px-2 py-1 rounded text-xs ${reqObj.status === 'APPROVED' ? 'bg-green-100 text-green-800' : reqObj.status === 'SENT_BACK' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                {reqObj.status}
              </div>
            </div>
          </div>
        ))}
        {requests.length === 0 && <div className="text-center p-8 text-gray-500">No requests found</div>}
      </div>
    </div>
  );
}
