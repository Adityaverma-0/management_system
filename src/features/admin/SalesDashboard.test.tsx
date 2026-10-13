import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SalesDashboard from './SalesDashboard';
import { linePoints } from './SalesCharts';
const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock('../auth/useApi', () => ({ useApi: () => fetchApi }));
afterEach(() => { cleanup(); fetchApi.mockReset(); });
const data = { stats: { totalSales: 30000, totalOrders: 2, uniqueCustomers: 1, avgOrderValue: 15000 }, invoices: [], analytics: { series: [{ date: '2026-10-14', amountPaise: 30000, bills: 2 }], payments: { CASH: 10000, UPI: 20000, CREDIT: 0 }, totalAmountPaise: 30000, totalBills: 2 } };
it('places both charts before orders and shares the existing filtered request', async () => {
  fetchApi.mockImplementation(async () => new Response(JSON.stringify(data)));
  render(<SalesDashboard />);
  const trend = await screen.findByRole('img', { name: 'Sales amount trend in rupees' });
  expect(screen.getByRole('img', { name: 'Sales by payment method' })).toBeTruthy();
  expect(trend.compareDocumentPosition(screen.getByText('Related Orders')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fetchApi).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('This Week'));
  await waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(2));
  expect(fetchApi.mock.calls[1][0]).toContain('period=week');
  fireEvent.click(screen.getByText('This Month'));
  await waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(3));
  expect(fetchApi.mock.calls[2][0]).toContain('period=month');
});
it('handles empty sales and a failed request', async () => {
  fetchApi.mockResolvedValueOnce(new Response(JSON.stringify({ ...data, analytics: { ...data.analytics, totalBills: 0, totalAmountPaise: 0, payments: { CASH: 0, UPI: 0, CREDIT: 0 }, series: [] } })));
  render(<SalesDashboard />);
  expect(await screen.findByText('No completed sales for this date range.')).toBeTruthy();
  expect(screen.getByText('No records for this date range.')).toBeTruthy();
  fetchApi.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 503 }));
  fireEvent.click(screen.getByText('This Week'));
  expect(await screen.findByText('Database unavailable')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});
it('keeps single-point and zero series geometry finite', () => {
  expect(linePoints([])).toEqual([]);
  expect(linePoints([0])).toEqual([{ x: 300, y: 165 }]);
  expect(linePoints([100])).toEqual([{ x: 300, y: 30 }]);
});
