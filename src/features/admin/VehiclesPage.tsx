import OlderLogs from './OlderLogs';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useApi } from '../auth/useApi';
import { formatRupees } from '../../domain/money';
import { formatQuantity } from '../../domain/units';
import { formatDateTimeIST } from '../../domain/dates';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

// WHAT: vehicles CRUD + per-vehicle monitoring (stock, assigned salesman, movement).
export default function VehiclesPage() {
  const fetchApi = useApi();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [godowns, setGodowns] = useState<any[]>([]);
  const [salesmen, setSalesmen] = useState<any[]>([]);
  const [selected, setSelected] = useState('');
  const [stock, setStock] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [godownId, setGodownId] = useState('');
  const [editId, setEditId] = useState('');

  const load = useCallback(async () => {
    try {
      const [v, g, s] = await Promise.all([
        fetchApi(`${API_URL}/admin/vehicles`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
        fetchApi(`${API_URL}/admin/godowns`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
        fetchApi(`${API_URL}/admin/salesmen`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
      ]);
      setVehicles(v); setGodowns(g); setSalesmen(s);
    } catch (e: any) { setError(e.message); }
  }, [fetchApi]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
    const [s, h] = await Promise.all([
      fetchApi(`${API_URL}/admin/vehicles/${id}/stock`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
      fetchApi(`${API_URL}/admin/vehicles/${id}/history`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
    ]);
    setStock(s); setHistory(h);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load stock.'); }
  }, [fetchApi]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (vehicles.length && !selected) setSelected(vehicles[0].id); }, [vehicles, selected]);
  useEffect(() => { loadDetail(selected); }, [selected, loadDetail]);

  const toProduct = (row: any) => ({ id: row.product_id, name: row.product_name, pricePaise: row.price_paise ?? 0, unitsPerStrip: row.units_per_strip, stripsPerBox: row.strips_per_box, piecesPerBox: row.pieces_per_box });
  const assignedSalesman = salesmen.find(s => s.vehicle_id === selected);
  const selectedVehicle = vehicles.find(v => v.id === selected);

  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
    if (!name || !godownId) return setError('Name and godown required');
    const res = editId
      ? await fetchApi(`${API_URL}/admin/vehicles/${editId}`, { method: 'PUT', body: JSON.stringify({ name, godown_id: godownId }) })
      : await fetchApi(`${API_URL}/admin/vehicles`, { method: 'POST', body: JSON.stringify({ name, godown_id: godownId }) });
    if (!res.ok) return setError((await res.json()).error || 'Save failed');
    setName(''); setGodownId(''); setEditId(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { saving.current = false; setBusy(false); }
  };

  return (
    <div className="space-y-4 dark:text-gray-100">
      <h2 className="text-2xl font-bold">Vehicles</h2>
      {error && <p className="text-red-600">{error}</p>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
        <h3 className="font-bold">Add / edit vehicle</h3>
        <div className="flex flex-wrap gap-2">
          <input className="border dark:border-gray-600 bg-transparent rounded p-2" placeholder="Vehicle name" value={name} onChange={e => setName(e.target.value)} />
          <select className="border dark:border-gray-600 bg-transparent rounded p-2" value={godownId} onChange={e => setGodownId(e.target.value)}>
            <option value="">Select godown (location comes from godown)</option>
            {godowns.map(g => <option key={g.id} value={g.id}>{g.name} — {g.location_name}</option>)}
          </select>
          <button disabled={busy} onClick={save} className="bg-blue-600 text-white rounded px-4 py-2">{editId ? 'Update' : 'Add'}</button>
          {editId && <button onClick={() => { setEditId(''); setName(''); setGodownId(''); }} className="border rounded px-4 py-2">Cancel</button>}
        </div>
        <table className="min-w-full text-sm">
          <thead className="text-left text-gray-500"><tr><th className="p-2">Name</th><th className="p-2">Location</th><th className="p-2">Godown</th><th className="p-2"></th></tr></thead>
          <tbody>{vehicles.map(v => (
            <tr key={v.id} className="border-t dark:border-gray-700">
              <td className="p-2"><button className={selected === v.id ? 'text-blue-600 font-bold' : ''} onClick={() => setSelected(v.id)}>{v.name}</button></td>
              <td className="p-2">{v.location_name}</td>
              <td className="p-2">{godowns.find(g => g.id === v.godown_id)?.name || v.godown_id}</td>
              <td className="p-2 text-right"><button className="text-blue-600" onClick={() => { setEditId(v.id); setName(v.name); setGodownId(v.godown_id); }}>Edit</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {selectedVehicle && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
          <h3 className="font-bold">{selectedVehicle.name} — {selectedVehicle.location_name}</h3>
          <p className="text-sm text-gray-500">Assigned salesman: {assignedSalesman ? assignedSalesman.name : '— none —'}</p>
          <h4 className="font-semibold">Current stock</h4>
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="p-2">Product</th><th className="p-2">Quantity</th><th className="p-2">Value</th></tr></thead>
            <tbody>{stock.map(row => (
              <tr key={row.product_id} className="border-t dark:border-gray-700">
                <td className="p-2">{row.product_name}</td>
                <td className="p-2">{formatQuantity(row.quantity_pieces, toProduct(row))}</td>
                <td className="p-2">{formatRupees(row.quantity_pieces * (row.price_paise ?? 0))}</td>
              </tr>
            ))}</tbody>
          </table>
          <h4 className="font-semibold">Movement history</h4>
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="p-2">When</th><th className="p-2">Type</th><th className="p-2">Product</th><th className="p-2">Qty</th><th className="p-2">Reason</th></tr></thead>
            <tbody>{history.map(r => (
              <tr key={r.id} className="border-t dark:border-gray-700">
                <td className="p-2">{formatDateTimeIST(r.timestamp ?? r.created_at)}</td>
                <td className="p-2">{r.type}</td>
                <td className="p-2">{r.product_name || r.product_id}</td>
                <td className="p-2">{r.quantity_pieces}</td>
                <td className="p-2">{r.reason || '-'}</td>
              </tr>
            ))}</tbody>
          </table>
          <OlderLogs url={`${API_URL}/admin/vehicles/${selected}/history`} rows={history} onRows={setHistory} />
        </div>
      )}
    </div>
  );
}
