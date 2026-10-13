import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../auth/useApi';

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v2';
const inputClass = 'border dark:border-gray-600 bg-transparent rounded p-2 w-full';
type Product = { id: string; name: string; active?: boolean };
type Godown = { id: string; name: string; location_name?: string; active?: boolean };
type Line = {
  product_id: string; description: string; quantity: string; unit: string; unit_price: string;
  taxable_amount: string; cgst: string; sgst: string; igst: string; discount_amount: string;
  gst: string; hsn: string; sku: string; barcode: string; line_total: string; discount: string; discount_type: string;
  match_status: 'MATCHED' | 'NEEDS_REVIEW' | 'NEW_PRODUCT'; match_reason: string;
  candidates: { id: string; name: string }[];
};
const emptyLine = (): Line => ({ product_id: '', description: '', quantity: '', unit: '', unit_price: '', taxable_amount: '', cgst: '', sgst: '', igst: '', discount_amount: '', gst: '', hsn: '', sku: '', barcode: '', line_total: '', discount: '', discount_type: '', match_status: 'NEW_PRODUCT', match_reason: '', candidates: [] });
const message = (e: unknown) => e instanceof Error ? e.message : 'The request failed. Please retry.';

async function importResponse(response: Response) {
  try { return await response.json(); }
  catch { throw new Error([502, 504].includes(response.status) ? 'The server or gateway timed out. Retry with fewer pages; ask the administrator to check invoice stage timings if this continues.' : 'The server returned an unreadable response. Please retry or contact the administrator.'); }
}

export default function InventoryImport() {
  const fetchApi = useApi({ backendOnly: true });
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const [masterError, setMasterError] = useState('');
  const [importRef, setImportRef] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [supplierGstin, setSupplierGstin] = useState('');
  const [selectedGodown, setSelectedGodown] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState('');
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewReady, setPreviewReady] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const busy = isExtracting || isSubmitting;

  const load = useCallback(async () => {
    try {
      const responses = await Promise.all([fetchApi(`${API_URL}/admin/godowns`), fetchApi(`${API_URL}/admin/products`)]);
      if (responses.some(response => !response.ok)) throw new Error('Could not load products and godowns from the server.');
      const [g, p] = await Promise.all(responses.map(response => response.json()));
      if (!Array.isArray(g) || !Array.isArray(p)) throw new Error('Invalid products or godowns response.');
      setGodowns(g.filter((item: Godown) => item.active !== false));
      setProducts(p.filter((item: Product) => item.active !== false));
      setMasterError('');
    } catch (e) { setMasterError(message(e)); }
  }, [fetchApi]);
  useEffect(() => { void load(); }, [load]);

  const resetPreview = () => {
    setLines([]); setImportRef(''); setSupplierName(''); setInvoiceDate(''); setSupplierGstin('');
    setInvoiceTotal(''); setReviewAcknowledged(false); setWarnings([]); setPreviewReady(false); setError(''); setSuccess('');
  };
  const updateLine = (index: number, field: keyof Line, value: string) => {
    setSuccess(''); setReviewAcknowledged(false);
    setLines(current => current.map((line, i) => i !== index ? line : {
      ...line, [field]: value,
      ...(field === 'product_id' ? { match_status: value ? 'MATCHED' as const : 'NEEDS_REVIEW' as const, match_reason: value ? 'Selected by you' : '' } : {}),
    }));
  };

  const handleExtractInvoice = async () => {
    if (operation.current) return;
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return setError('Please select a PDF file.');
    if (file.size > 20 * 1024 * 1024) return setError('Select a PDF no larger than 20 MB.');
    operation.current = true; resetPreview(); setIsExtracting(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('The selected PDF could not be read.'));
        reader.readAsDataURL(file);
      });
      const response = await fetchApi(`${API_URL}/admin/extract-invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileBase64: base64 }),
      });
      const data = await importResponse(response);
      if (!response.ok || !data.success || !Array.isArray(data.items)) throw new Error(data.error || 'Failed to extract invoice data.');
      setImportRef(data.invoice_number ?? ''); setSupplierName(data.supplier ?? '');
      setInvoiceTotal(data.amount === null || data.amount === undefined ? '' : String(data.amount));
      setInvoiceDate(data.invoice_date ?? ''); setSupplierGstin(data.supplier_gstin ?? '');
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setLines(data.items.map((item: Record<string, unknown>) => {
        const line = emptyLine();
        for (const key of ['product_id', 'description', 'quantity', 'unit', 'unit_price', 'gst', 'hsn', 'sku', 'barcode', 'line_total', 'discount', 'discount_type', 'taxable_amount', 'cgst', 'sgst', 'igst', 'discount_amount', 'match_reason'] as const) {
          line[key] = item[key] === null || item[key] === undefined ? '' : String(item[key]);
        }
        line.match_status = ['MATCHED', 'NEEDS_REVIEW', 'NEW_PRODUCT'].includes(String(item.match_status)) ? item.match_status as Line['match_status'] : 'NEEDS_REVIEW';
        line.candidates = Array.isArray(item.candidates) ? item.candidates : [];
        return line;
      }));
      setPreviewReady(true);
      if (data.items.length) setSuccess('Invoice extracted. Review each item and complete missing fields before saving.');
    } catch (e) { setError(message(e)); }
    finally { setIsExtracting(false); operation.current = false; }
  };

  const handleSubmit = async () => {
    if (operation.current) return;
    if (!importRef.trim() || !supplierName.trim() || !selectedGodown) return setError('Invoice number, supplier and receiving godown are required.');
    if (!godowns.some(g => g.id === selectedGodown)) return setError('Select an active godown.');
    if (!previewReady || !lines.length) return setError('At least one reviewed item is required.');
    for (const [i, line] of lines.entries()) {
      if (!products.some(p => p.id === line.product_id) || line.match_status !== 'MATCHED') return setError(`Item ${i + 1}: select an active product to confirm the match.`);
      if (!/^\d+(?:\.\d+)?$/.test(line.quantity) || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) return setError(`Item ${i + 1}: enter a positive quantity.`);
      if (!['BOX', 'STRIP', 'PIECE'].includes(line.unit)) return setError(`Item ${i + 1}: confirm the UOM.`);
      if (!/^\d+(?:\.\d{1,2})?$/.test(line.unit_price)) return setError(`Item ${i + 1}: enter a valid purchase price, with at most two decimal places.`);
    }
    operation.current = true; setIsSubmitting(true); setError(''); setSuccess('');
    try {
      const response = await fetchApi(`${API_URL}/admin/inventory/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_ref: importRef, supplier_name: supplierName, invoice_date: invoiceDate || null, supplier_gstin: supplierGstin || null, godown_id: selectedGodown, invoice_total: invoiceTotal, review_acknowledged: reviewAcknowledged, lines }),
      });
      const data = await importResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Inventory could not be saved.');
      resetPreview(); setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setSuccess('Inventory saved successfully. Updated stock is available in Godowns.');
      window.dispatchEvent(new Event('inventory-updated'));
    } catch (e) { setError(message(e)); }
    finally { setIsSubmitting(false); operation.current = false; }
  };

  return (
    <div className="space-y-4 dark:text-gray-100">
      <h2 className="text-2xl font-bold">Inventory PDF Import</h2>
      {error && <p role="alert" className="text-red-600 bg-red-100 p-2 rounded">{error}</p>}
      {masterError && <p role="alert" className="text-red-600 bg-red-100 p-2 rounded">{masterError}</p>}
      {success && <p role="status" className="text-green-600 bg-green-100 p-2 rounded">{success} <a className="underline" href="/godowns">View inventory</a></p>}
      <fieldset disabled={busy} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-4">
        <h3 className="font-bold">1. Select &amp; Extract PDF</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <input ref={fileInput} aria-label="Purchase invoice PDF" type="file" accept="application/pdf,.pdf" onChange={e => { resetPreview(); setFile(e.target.files?.[0] || null); }} className="border dark:border-gray-600 rounded p-1" />
          <button onClick={handleExtractInvoice} disabled={busy || !file} className="bg-gray-200 dark:bg-gray-700 rounded px-3 py-1 disabled:opacity-50">{isExtracting ? 'Extracting text...' : 'Extract PDF'}</button>
        </div>
      </fieldset>
      <fieldset disabled={busy} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-4">
        <h3 className="font-bold">2. Inventory Import Preview</h3>
        {warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-b pb-4 dark:border-gray-700">
          <label className="text-sm">Invoice number<input className={inputClass} value={importRef} onChange={e => setImportRef(e.target.value)} maxLength={255} /></label>
          <label className="text-sm">Supplier<input className={inputClass} value={supplierName} onChange={e => setSupplierName(e.target.value)} maxLength={255} /></label>
          <label className="text-sm">Receiving Godown<select className={inputClass} value={selectedGodown} onChange={e => setSelectedGodown(e.target.value)}><option value="">Select an active godown</option>{godowns.map(g => <option key={g.id} value={g.id}>{g.name} - {g.location_name}</option>)}</select></label>
          <label className="text-sm">Invoice date<input type="date" className={inputClass} value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></label>
          <label className="text-sm">Invoice total (₹)<input type="number" min="0" step="0.01" className={inputClass} value={invoiceTotal} onChange={e => { setInvoiceTotal(e.target.value); setReviewAcknowledged(false); }} /></label>
          <label className="text-sm">Supplier GSTIN<input className={inputClass} value={supplierGstin} onChange={e => setSupplierGstin(e.target.value.toUpperCase())} maxLength={15} /></label>
        </div>
        <div className="text-sm flex gap-3 flex-wrap">
          <a href="/products" target="_blank" rel="noreferrer" className="text-blue-600 underline">Open Products to create a new product</a>
          <a href="/godowns" target="_blank" rel="noreferrer" className="text-blue-600 underline">Manage godowns</a>
          <button onClick={() => void load()} className="text-blue-600 underline">Refresh products and godowns</button>
        </div>
        {!products.length && <p className="text-sm text-amber-700">No active products are available. Create products using the existing Products page, then refresh.</p>}
        {!godowns.length && <p className="text-sm text-amber-700">Create or activate a receiving godown before saving.</p>}
        <div className="space-y-2">
          <div className="flex justify-between items-center"><span className="text-sm font-semibold">Extracted Items</span>{previewReady && <button className="text-blue-600 underline text-sm" onClick={() => setLines(current => [...current, emptyLine()])}>Add item</button>}</div>
          {!lines.length ? <div className="text-center py-8 text-gray-400 border border-dashed rounded">{previewReady ? 'No reliable items detected. Add and review items before saving.' : 'Extract a PDF to preview items.'}</div> : lines.map((line, idx) => (
            <div key={idx} className="space-y-2 border dark:border-gray-700 rounded p-3">
              <div className="text-xs flex justify-between gap-3"><span>Extracted: <strong>{line.description || 'Manual item'}</strong></span><span className={line.match_status === 'MATCHED' ? 'text-green-600 font-bold' : 'text-orange-600 font-bold'}>{line.match_status.replace(/_/g, ' ')}</span></div>
              {line.match_reason && <p className="text-xs text-gray-500">{line.match_reason}</p>}
              {!!line.candidates.length && line.match_status !== 'MATCHED' && <p className="text-xs">Suggested: {line.candidates.map(p => p.name).join(', ')}. Select the correct product below.</p>}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <label className="text-sm col-span-2">Product {idx + 1}<select className={inputClass} value={line.product_id} onChange={e => updateLine(idx, 'product_id', e.target.value)}><option value="">Map to Product...</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className="text-sm">Quantity {idx + 1}<input type="number" min="0" step="any" className={inputClass} value={line.quantity} onChange={e => updateLine(idx, 'quantity', e.target.value)} /></label>
                <label className="text-sm">UOM {idx + 1}<select className={inputClass} value={line.unit} onChange={e => updateLine(idx, 'unit', e.target.value)}><option value="">Confirm unit...</option>{line.unit && !['BOX', 'STRIP', 'PIECE'].includes(line.unit) && <option value={line.unit}>{line.unit} — confirm conversion</option>}<option>BOX</option><option>STRIP</option><option>PIECE</option></select></label>
                {(['unit_price', 'gst', 'hsn', 'sku', 'barcode', 'line_total', 'discount', 'discount_amount', 'taxable_amount', 'cgst', 'sgst', 'igst'] as const).map(field => {
                  const labels = { unit_price: 'Purchase price (₹)', gst: 'GST (%)', hsn: 'HSN', sku: 'SKU', barcode: 'Barcode', line_total: 'Line total (₹)', discount: 'Discount', discount_amount: 'Printed discount amount (₹)', taxable_amount: 'Taxable amount (₹)', cgst: 'CGST (₹)', sgst: 'SGST (₹)', igst: 'IGST (₹)' };
                  const numeric = ['unit_price', 'gst', 'line_total', 'discount', 'discount_amount', 'taxable_amount', 'cgst', 'sgst', 'igst'].includes(field);
                  return <label key={field} className="text-sm">{labels[field]} {idx + 1}<input type={numeric ? 'number' : 'text'} min={numeric ? '0' : undefined} step={numeric ? '0.01' : undefined} className={inputClass} value={line[field]} onChange={e => updateLine(idx, field, e.target.value)} /></label>;
                })}
                <label className="text-sm">Discount type {idx + 1}<select className={inputClass} value={line.discount_type} onChange={e => updateLine(idx, 'discount_type', e.target.value)}><option value="">Select if applicable</option><option value="PERCENT">Percent</option><option value="AMOUNT">Amount (₹)</option></select></label>
              </div>
              <button onClick={() => setLines(current => current.filter((_, i) => i !== idx))} className="text-red-500 text-sm">Remove item {idx + 1}</button>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="ui-card bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-2">
        <h3 className="font-bold">3. Save to Inventory</h3>
        <p className="text-xs text-gray-500">Review quantities, units and purchase prices before saving to the receiving godown.</p>
        {invoiceTotal && lines.length > 0 && lines.every(line => line.line_total !== '') && Math.abs(lines.reduce((sum, line) => sum + Math.round(Number(line.line_total) * 100), 0) - Math.round(Number(invoiceTotal) * 100)) > 1 && <p role="alert" className="text-amber-700">Invoice total differs from the sum of line totals. Check missing pages, tax, freight and rounding.</p>}
        {previewReady && <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewAcknowledged} onChange={e => setReviewAcknowledged(e.target.checked)} />I checked all invoice pages, units and any total discrepancies against the PDF.</label>}
        <button onClick={handleSubmit} disabled={busy || !previewReady || !lines.length || !!masterError} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-4 py-3 font-bold w-full sm:w-auto">{isSubmitting ? 'Saving...' : 'Save to Inventory'}</button>
      </div>
    </div>
  );
}
