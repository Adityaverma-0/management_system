import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useApi } from '../auth/useApi';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

// Salesman assignments and credential updates are validated by the server.
export default function SalesmenPage() {
  const fetchApi = useApi();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [salesmen, setSalesmen] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [godowns, setGodowns] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [location, setLocation] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [password, setPassword] = useState('');
  const [editId, setEditId] = useState('');
  const [pinTarget, setPinTarget] = useState('');
  const [pin, setPin] = useState('');
  const [warning, setWarning] = useState('');

  
  const removeSalesman = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete salesman "${name}"?`)) return;
    try {
      const res = await fetchApi(`${API_URL}/admin/salesmen/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const load = useCallback(async () => {
    try {
      const [s, v, g] = await Promise.all([
        fetchApi(`${API_URL}/admin/salesmen`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
        fetchApi(`${API_URL}/admin/vehicles`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
        fetchApi(`${API_URL}/admin/godowns`).then(async r => { const data = await r.json(); if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Could not load records.'); return data; }),
      ]);
      setSalesmen(s); setVehicles(v); setGodowns(g);
    } catch (e: any) { setError(e.message); }
  }, [fetchApi]);

  useEffect(() => { load(); }, [load]);

  // WHY: a salesman's vehicle must belong to his location; filter the dropdown.
  const vehiclesForLocation = useMemo(() => vehicles.filter(v => !location || v.location_name === location), [vehicles, location]);
  const locations = useMemo(() => Array.from(new Set(godowns.map(g => g.location_name))), [godowns]);

  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
    if (!name || !mobile || !location || (!editId && !password)) return setError('Name, mobile, location, and password (for new salesman) are required');
    const res = editId
      ? await fetchApi(`${API_URL}/admin/salesmen/${editId}`, { method: 'PUT', body: JSON.stringify({ name, mobile, location_name: location, vehicle_id: vehicleId || null, status, ...(password ? {password} : {}) }) })
      : await fetchApi(`${API_URL}/admin/salesmen`, { method: 'POST', body: JSON.stringify({ name, mobile, location_name: location, vehicle_id: vehicleId || null, status, ...(password ? {password} : {}) }) });
    const body = await res.json();
    if (!res.ok) return setError(body.error || 'Save failed');
    if (body.warning) setWarning(body.warning);
    setName(''); setMobile(''); setLocation(''); setVehicleId(''); setStatus('ACTIVE'); setPassword(''); setEditId(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { saving.current = false; setBusy(false); }
  };

  const applyPin = async () => {
    try {
    if (!pinTarget || pin.length < 8) return setError('Choose a salesman and enter a password with at least 8 characters');
    const res = await fetchApi(`${API_URL}/admin/salesmen/${pinTarget}/set-pin`, { method: 'POST', body: JSON.stringify({ pin }) });
    const body = await res.json();
    if (!res.ok) return setError(body.error || 'PIN set failed');
    setPin(''); alert('Password updated.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update password.'); }
  };

  const resetPin = async (id: string) => {
    setPinTarget(id); setPin('');
    setError('Enter a new password in the reset form below, then save it.');
  };

  return (
    <div className="space-y-4 dark:text-gray-100">
      <h2 className="text-2xl font-bold">Salesmen</h2>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {warning && <p className="text-amber-600 text-sm">{warning}</p>}

      <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
        <h3 className="font-bold">Add / edit salesman</h3>
        <div className="flex flex-wrap gap-2">
          <label className="ui-field flex-1"><span>Name</span><input aria-label="Name" className="border dark:border-gray-600 bg-transparent rounded p-2" placeholder="Name" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="ui-field flex-1"><span>Mobile (10 digits)</span><input aria-label="Mobile (10 digits)" className="border dark:border-gray-600 bg-transparent rounded p-2" placeholder="Mobile (10 digits)" value={mobile} onChange={e => setMobile(e.target.value)} /></label>
          <label className="ui-field flex-1"><span>Location</span><select aria-label="Location" className="border dark:border-gray-600 bg-transparent rounded p-2" value={location} onChange={e => { setLocation(e.target.value); setVehicleId(''); }}>
            <option value="">Location</option>{locations.map(l => <option key={l}>{l}</option>)}
          </select></label>
          <label className="ui-field flex-1"><span>Vehicle (optional)</span><select aria-label="Vehicle (optional)" className="border dark:border-gray-600 bg-transparent rounded p-2" value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
            <option value="">Vehicle (optional)</option>{vehiclesForLocation.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
          <label className="ui-field flex-1"><span>Password</span><input aria-label="Password" type="password" className="border dark:border-gray-600 bg-transparent rounded p-2" placeholder={editId ? 'New Password (optional)' : 'Password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label className="ui-field flex-1"><span>Status</span><select aria-label="ACTIVE" className="border dark:border-gray-600 bg-transparent rounded p-2" value={status} onChange={e => setStatus(e.target.value)}>
            <option>ACTIVE</option><option>ON_HOLD</option><option>INACTIVE</option>
          </select></label>
          <button disabled={busy} onClick={save} className="bg-blue-600 text-white rounded px-4 py-2">{editId ? 'Update' : 'Add'}</button>
          {editId && <button onClick={() => { setEditId(''); setName(''); setMobile(''); setLocation(''); setVehicleId(''); setStatus('ACTIVE'); setPassword(''); }} className="border rounded px-4 py-2">Cancel</button>}
        </div>
      </div>

      <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3">
        <h3 className="font-bold">Set / reset password</h3>
        <div className="flex flex-wrap gap-2">
          <label className="ui-field flex-1"><span>Salesman</span><select aria-label="Select salesman" className="border dark:border-gray-600 bg-transparent rounded p-2" value={pinTarget} onChange={e => setPinTarget(e.target.value)}>
            <option value="">Select salesman</option>{salesmen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label className="ui-field flex-1"><span>New password (8+ characters)</span><input aria-label="New password (8+ characters)" className="border dark:border-gray-600 bg-transparent rounded p-2" placeholder="New password (8+ characters)" value={pin} onChange={e => setPin(e.target.value)} /></label>
          <button onClick={applyPin} className="bg-blue-600 text-white rounded px-4 py-2">Set password</button>
        </div>
        <p className="text-xs text-gray-500">The PIN is scrypt-hashed on the server and is never returned by any API, stored in the audit log, or displayed again.</p>
      </div>

      <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <div className="ui-table-scroll"><table className="min-w-full text-sm">
          <thead className="text-left text-gray-500"><tr><th className="p-2">Name</th><th className="p-2">Mobile</th><th className="p-2">Location</th><th className="p-2">Vehicle</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
          <tbody>{salesmen.map(s => (
            <tr key={s.id} className="border-t dark:border-gray-700">
              <td className="p-2">{s.name}</td>
              <td className="p-2">{s.mobile}</td>
              <td className="p-2">{s.location_name}</td>
              <td className="p-2">{vehicles.find(v => v.id === s.vehicle_id)?.name || '—'}</td>
              <td className="p-2">{s.status}</td>
              <td className="p-2 text-right space-x-2">
                <button className="text-blue-600 hover:underline" onClick={() => { setEditId(s.id); setName(s.name); setMobile(s.mobile); setLocation(s.location_name); setVehicleId(s.vehicle_id || ''); setStatus(s.status); }}>Edit</button>
                <button className="text-amber-600 hover:underline" onClick={() => resetPin(s.id)}>Reset PIN</button>
                <button className="text-red-600 hover:underline" onClick={() => removeSalesman(s.id, s.name)}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
