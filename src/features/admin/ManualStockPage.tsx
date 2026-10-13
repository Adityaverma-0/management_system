import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApi } from '../auth/useApi';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';

export default function ManualStockPage() {
  const fetchApi = useApi();
  const [godowns, setGodowns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [stock, setStock] = useState<any[]>([]);
  
  const [selectedGodown, setSelectedGodown] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('PIECE');
  const [reason, setReason] = useState('OTHER');
  const [note, setNote] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const loadData = useCallback(async () => {
    try {
      const gRes = await fetchApi(`${API_URL}/admin/godowns`);
      const pRes = await fetchApi(`${API_URL}/admin/products`);
      setGodowns(await gRes.json());
      setProducts(await pRes.json());
    } catch (e) { console.error('Error loading data:', e); }
  }, [fetchApi]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadStock = async (godownId: string) => {
    if (!godownId) return;
    try {
      const res = await fetchApi(`${API_URL}/admin/godowns/${godownId}/stock`);
      setStock(await res.json());
    } catch (e) {
      setStock([]);
    }
  };

  useEffect(() => { loadStock(selectedGodown); }, [selectedGodown]);

  const selectedProduct = useMemo(() => products.find(p => p.id === productId), [products, productId]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products;
    return products.filter(p => 
      p.name && p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const getPiecesMultiplier = () => {
    if (!selectedProduct) return 1;
    if (unit === 'BOX') return Number(selectedProduct.pieces_per_box) || 0;
    if (unit === 'STRIP') return Number(selectedProduct.units_per_strip) || 0;
    return 1;
  };

  const calculatedPieces = useMemo(() => {
    const q = Number(quantity);
    if (!q || q <= 0) return 0;
    return q * getPiecesMultiplier();
  }, [quantity, unit, selectedProduct]);

  const handleSubmit = async () => {
    if (!selectedGodown || !productId || !Number(quantity)) return;
    setIsSubmitting(true);
    try {
      await fetchApi(`${API_URL}/admin/stock/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            godown_id: selectedGodown,
            product_id: productId,
            quantity_pieces: calculatedPieces,
            unit,
            unit_quantity: Number(quantity),
            kind: 'IN', // Manual Add
            reason,
            note
        })
      });
      setMessage('Stock added successfully');
      setQuantity(''); setNote('');
      setSearchTerm('');
      setProductId('');
      setUnit('PIECE');
      loadStock(selectedGodown);
    } catch (e: any) { setMessage('Error: ' + e.message); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="space-y-6 dark:text-gray-100">
      <h2 className="text-2xl font-bold">Manual Stock Management</h2>
      <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded shadow">
        <label htmlFor="ui-field-1" className="block text-sm mb-2">Select Warehouse</label>
        <select id="ui-field-1" value={selectedGodown} onChange={e => setSelectedGodown(e.target.value)} className="w-full p-2 border rounded bg-transparent">
          <option value="">-- Select --</option>
          {godowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {selectedGodown && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded shadow">
            <h3 className="font-bold mb-4">Add Manual Stock</h3>
            <div className="space-y-3">
              <input aria-label="Search Product..."
                type="text" 
                placeholder="Search Product..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
                className="w-full p-2 border rounded bg-transparent" 
              />
              <label className="ui-field flex-1"><span>Product</span><select aria-label="Product" value={productId} onChange={e => { setProductId(e.target.value); setUnit('PIECE'); }} className="w-full p-2 border rounded bg-transparent">
                <option value="">{searchTerm ? (filteredProducts.length > 0 ? `Select from ${filteredProducts.length} matches...` : 'No matches found') : 'Select Product...'}</option>
                {filteredProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
              
              <div className="flex gap-2">
                <label className="ui-field flex-1"><span>Quantity</span><input aria-label="Quantity" type="number" placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full p-2 border rounded bg-transparent" /></label>
                <label className="ui-field flex-1"><span>Pieces</span><select aria-label="Pieces" value={unit} onChange={e => setUnit(e.target.value)} className="p-2 border rounded bg-transparent w-32">
                  <option value="PIECE">Pieces</option>
                  <option value="STRIP" disabled={!selectedProduct || !selectedProduct.units_per_strip}>Strips</option>
                  <option value="BOX" disabled={!selectedProduct || !selectedProduct.pieces_per_box}>Boxes</option>
                </select></label>
              </div>
              {calculatedPieces > 0 && <p className="text-sm text-gray-500">Preview: {calculatedPieces} total pieces.</p>}

              <label className="ui-field flex-1"><span>Opening Stock</span><select aria-label="Opening Stock" value={reason} onChange={e => setReason(e.target.value)} className="w-full p-2 border rounded bg-transparent">
                <option value="OPENING_STOCK">Opening Stock</option>
                <option value="OTHER">Other</option>
              </select></label>
              <label className="ui-field flex-1"><span>Note</span><input aria-label="Note" placeholder="Note" value={note} onChange={e => setNote(e.target.value)} className="w-full p-2 border rounded bg-transparent" /></label>
              <button disabled={isSubmitting || calculatedPieces <= 0} onClick={handleSubmit} className="w-full bg-blue-600 text-white p-2 rounded">Add Stock</button>
              {message && <p className="text-sm p-2">{message}</p>}
            </div>
          </div>

          <div className="ui-card bg-white dark:bg-gray-800 p-4 rounded shadow">
            <h3 className="font-bold mb-4">Current Stock</h3>
            <div className="ui-table-scroll"><table className="w-full text-sm">
              <thead className="text-left dark:text-gray-400"><tr><th>Product</th><th>Qty</th></tr></thead>
              <tbody>{stock.map(s => <tr key={s.product_id}><td>{s.product_name}</td><td>{s.quantity_pieces}</td></tr>)}</tbody>
            </table></div>
          </div>
        </div>
      )}
    </div>
  );
}
