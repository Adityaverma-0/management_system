import OlderLogs from './OlderLogs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../auth/useApi';
import { formatRupees } from '../../domain/money';
import { formatQuantity } from '../../domain/units';
import { formatDateTimeIST } from '../../domain/dates';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

const ADJUST_REASONS = ['OPENING_STOCK', 'DAMAGE', 'LOSS', 'FOUND', 'CORRECTION', 'OTHER'];

// WHAT: one page to run a godown end-to-end: list/edit, see stock, adjust stock, view history.
export default function GodownsPage() {
  const fetchApi = useApi();
  const [godowns, setGodowns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [stock, setStock] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'stock' | 'history' | 'add' | 'adjust'>('stock');
  const [name, setName] = useState(''); const [location, setLocation] = useState('');
  const [editId, setEditId] = useState('');
  const [active, setActive] = useState(true);
  const [search, setSearch] = useState('');
  const [histSearch, setHistSearch] = useState('');

  
  const removeGodown = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete godown "${name}"?`)) return;
    try {
      const res = await fetchApi(`${API_URL}/admin/godowns/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      if (selected === id) setSelected('');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const load = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([fetchApi(`${API_URL}/admin/godowns`), fetchApi(`${API_URL}/admin/products`)]);
      const [gs, ps] = await Promise.all([g.json(), p.json()]);
      if (!g.ok || !p.ok || !Array.isArray(gs) || !Array.isArray(ps)) throw new Error('Could not load products and godowns.');
      setGodowns(gs); setProducts(ps);
    } catch (e: any) { setError(e.message); }
  }, [fetchApi]);

  const loadStock = useCallback(async (id: string) => {
    if (!id) { setStock([]); setHistory([]); return; }
    try {
    const [s, h] = await Promise.all([
      fetchApi(`${API_URL}/admin/godowns/${id}/stock`),
      fetchApi(`${API_URL}/admin/godowns/${id}/history`),
    ]);
    const [stockRows, historyRows] = await Promise.all([s.json(), h.json()]);
    if (!s.ok || !h.ok || !Array.isArray(stockRows) || !Array.isArray(historyRows)) throw new Error('Could not refresh inventory.');
    setStock(stockRows); setHistory(historyRows);
    } catch (e: any) { setError(e.message); }
  }, [fetchApi]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (godowns.length && !selected) setSelected(godowns[0].id); }, [godowns, selected]);
  useEffect(() => { void loadStock(selected); }, [selected, loadStock]);

  useEffect(() => {
    const refresh = () => { void load(); void loadStock(selected); };
    window.addEventListener('focus', refresh);
    window.addEventListener('inventory-updated', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('inventory-updated', refresh); };
  }, [load, loadStock, selected]);

  const toProduct = (row: any) => ({ id: row.product_id, name: row.product_name, pricePaise: row.price_paise ?? 0, unitsPerStrip: row.units_per_strip, stripsPerBox: row.strips_per_box, piecesPerBox: row.pieces_per_box });

  const filteredStock = useMemo(() => stock.filter(r => r.product_name.toLowerCase().includes(search.toLowerCase())), [stock, search]);
  const filteredHistory = useMemo(() => history.filter(r =>
    (!histSearch || (r.type || '').includes(histSearch.toUpperCase()) || String(r.product_id).includes(histSearch))
  ), [history, histSearch]);

  const saveGodown = async () => {
    if (!name || !location) return setError('Name and location required');
    try {
    const res = editId
      ? await fetchApi(`${API_URL}/admin/godowns/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, location_name: location, active }) })
      : await fetchApi(`${API_URL}/admin/godowns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, location_name: location, active }) });
    if (!res.ok) return setError((await res.json()).error || 'Save failed');
    setName(''); setLocation(''); setEditId(''); setActive(true); await load();
    } catch (e: any) { setError(e.message || 'Could not save godown.'); }
  };

  return (
    <div className="space-y-4 dark:text-gray-100">
      <h2 className="text-2xl font-bold">Godowns</h2>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
        <h3 className="font-bold">Add / edit godown</h3>
        <div className="flex flex-wrap gap-2">
          <label className="ui-field flex-1"><span>Godown name</span><input aria-label="Godown name" className="border dark:border-gray-600 bg-transparent rounded p-2" placeholder="Godown name" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="ui-field flex-1"><span>Location (e.g. Hardpiplya/Dewas)</span><input aria-label="Location (e.g. Hardpiplya/Dewas)" className="border dark:border-gray-600 bg-transparent rounded p-2" placeholder="Location (e.g. Hardpiplya/Dewas)" value={location} onChange={e => setLocation(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active</label>
          <button onClick={saveGodown} className="bg-blue-600 text-white rounded px-4 py-2">{editId ? 'Update' : 'Add'}</button>
          {editId && <button onClick={() => { setEditId(''); setName(''); setLocation(''); setActive(true); }} className="border rounded px-4 py-2">Cancel</button>}
        </div>
        <div className="ui-table-scroll"><table className="min-w-full text-sm">
          <thead className="text-left text-gray-500"><tr><th className="p-2">Name</th><th className="p-2">Location</th><th className="p-2"></th></tr></thead>
          <tbody>{godowns.map(g => (
            <tr key={g.id} className="border-t dark:border-gray-700">
              <td className="p-2">
                <button className={selected === g.id ? 'text-blue-600 font-bold' : ''} onClick={() => setSelected(g.id)}>{g.name}{g.active === false ? ' (Inactive)' : ''}</button>
              </td>
              <td className="p-2">{g.location_name}</td>
              <td className="p-2 text-right space-x-2">
                <button className="text-blue-600 hover:underline" onClick={() => { setEditId(g.id); setName(g.name); setLocation(g.location_name); setActive(g.active !== false); }}>Edit</button>
                <button className="text-red-600 hover:underline" onClick={() => removeGodown(g.id, g.name)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>

      <div className="flex gap-2">
        {(['stock', 'history', 'add', 'adjust'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded ${tab === t ? 'bg-blue-600 text-white' : 'border dark:border-gray-600'}`}>{t === 'add' ? 'Stock in' : t === 'adjust' ? 'Adjust' : t === 'stock' ? 'Current stock' : 'History'}</button>
        ))}
      </div>

      {tab === 'stock' && (
        <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
          <input aria-label="Search product…" className="border dark:border-gray-600 bg-transparent rounded p-2 w-full" placeholder="Search product…" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="ui-table-scroll"><table className="min-w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="p-2">Product</th><th className="p-2">Quantity</th><th className="p-2">Value</th><th className="p-2">Status</th></tr></thead>
            <tbody>{filteredStock.map(row => {
              const prod = toProduct(row);
              const low = row.quantity_pieces < prod.unitsPerStrip; // low when less than one strip worth
              return (
                <tr key={row.product_id} className="border-t dark:border-gray-700">
                  <td className="p-2">{row.product_name}</td>
                  <td className="p-2">{formatQuantity(row.quantity_pieces, prod)}</td>
                  <td className="p-2">{formatRupees(row.quantity_pieces * prod.pricePaise)}</td>
                  <td className="p-2">{low ? <span className="text-xs bg-red-100 text-red-700 rounded px-2 py-0.5">Low</span> : <span className="text-xs bg-green-100 text-green-700 rounded px-2 py-0.5">OK</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <OlderLogs url={`${API_URL}/admin/godowns/${selected}/history`} rows={history} onRows={setHistory} />
        </div>
      )}

      {tab === 'history' && (
        <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
          <input aria-label="Filter by type or product id…" className="border dark:border-gray-600 bg-transparent rounded p-2 w-full" placeholder="Filter by type or product id…" value={histSearch} onChange={e => setHistSearch(e.target.value)} />
          <div className="ui-table-scroll"><table className="min-w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="p-2">When</th><th className="p-2">Type</th><th className="p-2">Product</th><th className="p-2">Qty</th><th className="p-2">Reason</th></tr></thead>
            <tbody>{filteredHistory.map(r => (
              <tr key={r.id} className="border-t dark:border-gray-700">
                <td className="p-2">{formatDateTimeIST(r.timestamp ?? r.created_at)}</td>
                <td className="p-2">{r.type}</td>
                <td className="p-2">{r.product_name || r.product_id}</td>
                <td className="p-2">{r.quantity_pieces}</td>
                <td className="p-2">{r.reason || '-'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {tab === 'add' && <StockEntryForm mode="IN" godowns={godowns.filter(g => selected ? g.id === selected : true)} products={products} selectedGodown={selected} onDone={() => loadStock(selected)} />}
      {tab === 'adjust' && <StockEntryForm mode="ADJ" godowns={godowns.filter(g => selected ? g.id === selected : true)} products={products} selectedGodown={selected} onDone={() => loadStock(selected)} />}
    </div>
  );
}

function StockEntryForm({ mode, godowns, products, selectedGodown, onDone }: any) {
  const fetchApi = useApi();
  const [godownId, setGodownId] = useState(selectedGodown || '');
  useEffect(() => { setGodownId(selectedGodown || ''); }, [selectedGodown]);
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<'BOX' | 'STRIP' | 'PIECE'>('BOX');
  const [kind, setKind] = useState(mode === 'IN' ? 'IN' : 'ADJ_PLUS');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => `adj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const product = products.find((p: any) => p.id === productId);

  const submit = async () => {
    try {
    if (!godownId || !productId || !reason || !Number(amount)) return setError('All fields except note are required');
    const pieces = Number(amount) * (unit === 'BOX' ? product?.pieces_per_box ?? 1 : unit === 'STRIP' ? product?.units_per_strip ?? 1 : 1);
    const res = await fetchApi(`${API_URL}/admin/stock/adjust`, {
      method: 'POST',
      body: JSON.stringify({ godown_id: godownId, product_id: productId, quantity_pieces: pieces, kind, reason, note, idempotency_key: idempotencyKey }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error || 'Failed');
    onDone();
    setAmount(''); setNote(''); setReason('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update stock.'); }
  };

  return (
    <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
      <h3 className="font-bold">{mode === 'IN' ? 'Stock in' : 'Stock adjustment'}</h3>
      <label className="ui-field flex-1"><span>Select godown</span><select aria-label="Select godown" value={godownId} onChange={e => setGodownId(e.target.value)} className="border dark:border-gray-600 bg-transparent rounded p-2 w-full">
        <option value="">Select godown</option>{godowns.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select></label>
      <label className="ui-field flex-1"><span>Product</span><select aria-label="Select product" value={productId} onChange={e => setProductId(e.target.value)} className="border dark:border-gray-600 bg-transparent rounded p-2 w-full">
        <option value="">Select product</option>{products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <div className="flex gap-2">
        <label className="ui-field flex-1"><span>Quantity</span><input aria-label="Quantity" type="number" min="0" className="border dark:border-gray-600 bg-transparent rounded p-2 flex-1" placeholder="Quantity" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="ui-field flex-1"><span>BOX</span><select aria-label="BOX" value={unit} onChange={e => setUnit(e.target.value as any)} className="border dark:border-gray-600 bg-transparent rounded p-2">
          <option>BOX</option><option>STRIP</option><option>PIECE</option>
        </select></label>
        {mode === 'IN' ? (
          <span className="border dark:border-gray-600 rounded p-2 text-sm">Type: IN</span>
        ) : (
          <label className="ui-field flex-1"><span>ADJ+</span><select aria-label="ADJ+" value={kind} onChange={e => setKind(e.target.value)} className="border dark:border-gray-600 bg-transparent rounded p-2">
            <option value="ADJ_PLUS">ADJ+</option><option value="ADJ_MINUS">ADJ-</option>
          </select></label>
        )}
      </div>
      <label className="ui-field flex-1"><span>Select reason (required)</span><select aria-label="Select reason (required)" value={reason} onChange={e => setReason(e.target.value)} className="border dark:border-gray-600 bg-transparent rounded p-2 w-full">
        <option value="">Select reason (required)</option>{ADJUST_REASONS.map(r => <option key={r}>{r}</option>)}
      </select></label>
      <label className="ui-field flex-1"><span>Optional note</span><input aria-label="Optional note" className="border dark:border-gray-600 bg-transparent rounded p-2 w-full" placeholder="Optional note" value={note} onChange={e => setNote(e.target.value)} /></label>
      <p className="text-xs text-gray-500">Stock is never allowed to go negative. Idempotency key: {idempotencyKey} (safe to retry).</p>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <button onClick={submit} className="bg-blue-600 text-white rounded px-4 py-2">Submit</button>
    </div>
  );
}
