/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InventoryImport from './InventoryImport';

const { fetchApi, hook } = vi.hoisted(() => ({ fetchApi: vi.fn(), hook: vi.fn() }));
vi.mock('../auth/useApi', () => ({ useApi: (options: unknown) => { hook(options); return fetchApi; } }));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const extracted = () => ({ success: true, invoice_number: 'INV-1', supplier: 'Acme', invoice_date: '2026-10-08', warnings: [], items: [{ description: 'Pens', product_id: 'p1', match_status: 'MATCHED', quantity: 5, unit: null, unit_price: null, candidates: [] }] });
const selectFile = () => fireEvent.change(screen.getByLabelText('Purchase invoice PDF'), { target: { files: [new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' })] } });
const extract = async () => {
  selectFile(); fireEvent.click(screen.getByRole('button', { name: 'Extract PDF' }));
  await screen.findByLabelText('Product 1');
};
const saveCalls = () => fetchApi.mock.calls.filter(([url]) => String(url).endsWith('/inventory/import'));

beforeEach(() => {
  fetchApi.mockReset(); hook.mockReset();
  fetchApi.mockImplementation(async (url: string) => {
    if (url.endsWith('/godowns')) return response([{ id: 'g1', name: 'Main', active: true }, { id: 'g2', name: 'Inactive godown', active: false }]);
    if (url.endsWith('/products')) return response([{ id: 'p1', name: 'Pens', active: true }, { id: 'p2', name: 'Inactive product', active: false }]);
    if (url.endsWith('/extract-invoice')) return response(extracted());
    if (url.endsWith('/inventory/import')) return response({ success: true, id: 'imp-1' });
    throw new Error('Unexpected request');
  });
});
afterEach(cleanup);

describe('inventory import preview', () => {
  it('uses backend-only requests and never saves during extraction; missing values stay blank', async () => {
    render(<InventoryImport />); await extract();
    expect(hook).toHaveBeenCalledWith({ backendOnly: true });
    expect(saveCalls()).toHaveLength(0);
    expect((screen.getByLabelText('UOM 1') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Purchase price (₹) 1') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Inactive product')).toBeNull();
    expect(screen.queryByText('Inactive godown')).toBeNull();
    fireEvent.change(screen.getByLabelText('Receiving Godown'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Inventory' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Item 1: confirm the UOM.');
    expect(saveCalls()).toHaveLength(0);
  });

  it('sends reviewed fields only on save and resets after successful persistence', async () => {
    render(<InventoryImport />); await extract();
    for (const [label, value] of [['Receiving Godown', 'g1'], ['UOM 1', 'BOX'], ['Purchase price (₹) 1', '450.25'], ['Quantity 1', '20'], ['GST (%) 1', '5'], ['HSN 1', '9608'], ['SKU 1', 'SKU-42'], ['Invoice number', 'EDITED-1'], ['Supplier', 'Reviewed Supplier']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save to Inventory' }));
    await screen.findByText(/Inventory saved successfully/);
    expect(saveCalls()).toHaveLength(1);
    const request = saveCalls()[0][1];
    expect(request.headers['Content-Type']).toBe('application/json');
    const data = JSON.parse(request.body);
    expect(data).toMatchObject({ import_ref: 'EDITED-1', supplier_name: 'Reviewed Supplier', godown_id: 'g1' });
    expect(data.lines[0]).toMatchObject({ product_id: 'p1', quantity: '20', unit: 'BOX', unit_price: '450.25', gst: '5', hsn: '9608', sku: 'SKU-42' });
    expect(data.lines[0].quantity_pieces).toBeUndefined(); // The server calculates stock units.
    expect(screen.queryByLabelText('Product 1')).toBeNull();
  });

  it('invalidates the old preview when a different file is selected', async () => {
    render(<InventoryImport />); await extract(); selectFile();
    expect(screen.queryByLabelText('Product 1')).toBeNull();
    expect((screen.getByLabelText('Invoice number') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Save to Inventory' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires explicit product selection for similar-name candidates', async () => {
    const original = fetchApi.getMockImplementation()!;
    fetchApi.mockImplementation((url: string) => url.endsWith('/extract-invoice') ? Promise.resolve(response({ ...extracted(), items: [{ ...extracted().items[0], match_status: 'NEEDS_REVIEW', product_id: null, unit: 'BOX', unit_price: 100, candidates: [{ id: 'p1', name: 'Pens' }] }] })) : original(url));
    render(<InventoryImport />); await extract();
    fireEvent.change(screen.getByLabelText('Receiving Godown'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Inventory' }));
    expect((await screen.findByRole('alert')).textContent).toContain('confirm the match');
    expect(saveCalls()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Product 1'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Inventory' }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
  });

  it('shows duplicate errors and preserves the reviewed form', async () => {
    const original = fetchApi.getMockImplementation()!;
    fetchApi.mockImplementation((url: string) => url.endsWith('/inventory/import') ? Promise.resolve(response({ success: false, error: 'This invoice may already have been imported.' }, 409)) : original(url));
    render(<InventoryImport />); await extract();
    for (const [label, value] of [['Receiving Godown', 'g1'], ['UOM 1', 'PIECE'], ['Purchase price (₹) 1', '10']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Inventory' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already have been imported');
    expect((screen.getByLabelText('Quantity 1') as HTMLInputElement).value).toBe('5');
  });

  it('shows extraction failure without offering to save an old preview', async () => {
    render(<InventoryImport />); await extract();
    const original = fetchApi.getMockImplementation()!;
    fetchApi.mockImplementation((url: string) => url.endsWith('/extract-invoice') ? Promise.resolve(response({ success: false, error: 'This PDF requires local OCR.' }, 422)) : original(url));
    fireEvent.click(screen.getByRole('button', { name: 'Extract PDF' }));
    expect((await screen.findByRole('alert')).textContent).toContain('requires local OCR');
    expect(screen.queryByLabelText('Product 1')).toBeNull();
    expect(saveCalls()).toHaveLength(0);
  });
});

it('distinguishes a non-JSON gateway timeout and never writes inventory', async () => {
  const original = fetchApi.getMockImplementation()!;
  fetchApi.mockImplementation((url: string) => url.endsWith('/extract-invoice') ? Promise.resolve(new Response('<html>Gateway timeout</html>', { status: 504 })) : original(url));
  render(<InventoryImport />); selectFile();
  fireEvent.click(screen.getByRole('button', { name: 'Extract PDF' }));
  expect((await screen.findByRole('alert')).textContent).toContain('server or gateway timed out');
  expect(saveCalls()).toHaveLength(0);
});

it('previews separate tax and discount amounts and flags invoice total differences', async () => {
  const original = fetchApi.getMockImplementation()!;
  fetchApi.mockImplementation((url: string) => url.endsWith('/extract-invoice') ? Promise.resolve(response({ ...extracted(), amount: 250, items: [{ ...extracted().items[0], unit: 'BAGS', unit_price: 100, quantity: 2, discount: 5, discount_type: 'PERCENT', discount_amount: 10, taxable_amount: 190, cgst: 9.5, sgst: 9.5, line_total: 209 }] })) : original(url));
  render(<InventoryImport />); await extract();
  expect((screen.getByLabelText('Taxable amount (₹) 1') as HTMLInputElement).value).toBe('190');
  expect((screen.getByLabelText('Printed discount amount (₹) 1') as HTMLInputElement).value).toBe('10');
  expect((screen.getByLabelText('CGST (₹) 1') as HTMLInputElement).value).toBe('9.5');
  expect((screen.getByLabelText('IGST (₹) 1') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('UOM 1') as HTMLSelectElement).value).toBe('BAGS');
  expect(screen.getByRole('alert').textContent).toContain('Invoice total differs');
  expect(saveCalls()).toHaveLength(0);
});

it.skipIf(!process.env.INVOICE_PREVIEW_FIXTURE)('displays all 37 rows extracted from the private scan without saving', async () => {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(process.env.INVOICE_PREVIEW_FIXTURE!, 'utf8'));
  const original = fetchApi.getMockImplementation()!;
  fetchApi.mockImplementation((url: string) => url.endsWith('/extract-invoice') ? Promise.resolve(response(data)) : original(url));
  render(<InventoryImport />); await extract();
  expect(screen.getAllByLabelText(/^Product \d+$/)).toHaveLength(37);
  expect(screen.getByText(/Chinese Pasta/)).toBeTruthy();
  expect(screen.getByText(/Masala Sev Mamra/)).toBeTruthy();
  expect((screen.getByLabelText('Purchase price (₹) 1') as HTMLInputElement).value).toBe('256.99');
  expect(saveCalls()).toHaveLength(0);
});
