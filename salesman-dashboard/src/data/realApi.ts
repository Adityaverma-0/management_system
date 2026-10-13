import { getDB } from './db';
import { request, session, acknowledge } from './apiClient';
import { setCatalog } from './catalog';
import { Customer, DayState, Invoice, WorkDay } from '../domain/types';


let currentTax: { cgst: number; sgst: number } = (() => {
  try {
    const saved = localStorage.getItem("app_tax_settings");
    return saved ? JSON.parse(saved) : { cgst: 0, sgst: 0 };
  } catch {
    return { cgst: 0, sgst: 0 };
  }
})();

export function getTaxSettings(): { cgst: number; sgst: number } {
  return currentTax;
}

export async function fetchTaxSettings(): Promise<{ cgst: number; sgst: number }> {
  try {
    const res = await request("/settings/tax");
    if (res && (typeof res.cgst === "number" || typeof res.sgst === "number")) {
      currentTax = { cgst: Number(res.cgst) || 0, sgst: Number(res.sgst) || 0 };
      try { localStorage.setItem("app_tax_settings", JSON.stringify(currentTax)); } catch {}
    }
  } catch {}
  return currentTax;
}

let refreshing: Promise<void> | null = null;
let refreshedAt = 0;
let refreshedAccount = ''; 
export function refreshData(force = false): Promise<void> {
  if (!force && refreshedAccount === session()?.user?.id && Date.now() - refreshedAt < 1000) return Promise.resolve();
  if (refreshing) return refreshing;
  const account = session()?.user?.id;
  refreshing = (async () => {
    const data = await request('/salesman/snapshot');
    if (account !== session()?.user?.id) return;
    const db = await getDB();
    const stores = ['ledger','loads','invoices','workDays','customers','accounting','outlets'] as const;
    const tx = db.transaction([...stores], 'readwrite');
    for (const name of stores) {
      const store = tx.objectStore(name);
      await store.clear();
      await Promise.all(data[name].map((row: any) => store.put(row)));
    }
    await tx.done; setCatalog(data.products);
    if (data.tax) {
      currentTax = { cgst: Number(data.tax.cgst) || 0, sgst: Number(data.tax.sgst) || 0 };
      try { localStorage.setItem("app_tax_settings", JSON.stringify(currentTax)); } catch {}
    }
    refreshedAt = Date.now(); refreshedAccount = account;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function mutate(path: string, body: unknown) {
  // Finish earlier reads before the commit so their snapshots cannot overwrite newer data.
  if (refreshing) await refreshing;
  const result = await request(path, body, true);
  await refreshData(true); acknowledge(path, body); return result;
}
let starting: Promise<WorkDay> | null = null;
export function fetchActiveWorkDay(): Promise<WorkDay> {
  if (starting) return starting;
  starting = (async () => {
    await refreshData();
    let days = await (await getDB()).getAll('workDays');
    let active = days.find(d => d.state !== 'CLOSED');
    if (!active) {
      await mutate('/salesman/work-days', {});
      days = await (await getDB()).getAll('workDays'); active = days.find(d => d.state !== 'CLOSED');
    }
    if (!active) throw new Error('No active work day. Ask your administrator to check your assignment.');
    return active;
  })().finally(() => { starting = null; });
  return starting;
}
export const startNewWorkDay = fetchActiveWorkDay;
export const devResetDay = fetchActiveWorkDay;
export const seedInitialData = refreshData; // Compatibility only: production never seeds records.
export const updateDayState = (id: string, state: DayState) => mutate(`/salesman/work-days/${id}/state`, {state});
export const submitLoadStock = (workDayId: string, _warehouseId: string, _vehicleId: string, items: {productId:string;quantityPieces:number}[]) => mutate('/salesman/stock-requests',{workDayId,items});
export async function saveSaleGenerateInvoice(workDayId: string, sale: Omit<Invoice,'id'|'invoiceNumber'|'status'|'createdAt'|'calendarDate'|'previousBalancePaise'|'newBalancePaise'|'workDayId'|'customerName'>): Promise<string> {
  if (refreshing) await refreshing;
  const body = {...sale,workDayId};
  const result = await request('/salesman/sales',body,true);
  // Receipt is fetched directly from the server. Refresh stock/history on the next view.
  refreshedAt = 0;
  acknowledge('/salesman/sales',body);
  return result.id;
}
export const cancelInvoice = (id: string) => mutate(`/salesman/invoices/${id}/cancel`,{});
export const addCustomer = (customer: Customer) => mutate('/salesman/customers',customer);
export const submitUnloadRequest = (workDayId: string,cashCollected: number,heldItems: Record<string,number>,unloadedItems: Record<string,number>,cashBreakdown?: Record<string,number>,cashTotalPaise?: number,noteCount?: number,coinCount?: number) => mutate('/unload-requests',{workDayId,cashCollected,heldItems,unloadedItems,cashBreakdown,cashTotalPaise,noteCount,coinCount});
export const adminApprove = (id: string) => mutate(`/unload-requests/${id}/approve`,{});
export const adminSendBack = (id: string,note: string) => mutate(`/unload-requests/${id}/send-back`,{note});
export const syncUnloadStateFromServer = (_id: string,_status: string,_note: string) => refreshData();
export async function getCustomers() { await refreshData(); return (await getDB()).getAll('customers'); }
export async function getLedger() { await refreshData(); return (await getDB()).getAll('ledger'); }
export async function getLoads() { await refreshData(); return (await getDB()).getAll('loads'); }
export async function getInvoices() { await refreshData(); return (await getDB()).getAll('invoices'); }
export async function getInvoice(id: string): Promise<Invoice> { return request(`/salesman/invoices/${encodeURIComponent(id)}`); }
export async function getOutlets() { await refreshData(); return (await getDB()).getAll('outlets'); }
export async function getAccountingEntries() { await refreshData(); return (await getDB()).getAll('accounting'); }
export async function getAllWorkDays() { await refreshData(); return (await getDB()).getAll('workDays'); }
export async function saveCashDraft(id: string,breakdown: Record<string,number>) { await (await getDB()).put('drafts',breakdown,`cash_draft_${id}`); }
export async function getCashDraft(id: string): Promise<Record<string,number>|undefined> { return (await getDB()).get('drafts',`cash_draft_${id}`); }
export async function clearCashDraft(id: string) { await (await getDB()).delete('drafts',`cash_draft_${id}`); }

export interface SalesAnalyticsData {
  from: string; to: string; period: string;
  series: { date: string; amountPaise: number; bills: number }[];
  payments: Record<'CASH'|'UPI'|'CREDIT', number>;
  statuses: Record<'VALID'|'VOID', number>;
  totalAmountPaise: number; totalBills: number;
}
export function getSalesAnalytics(from: string, to: string, period: string): Promise<SalesAnalyticsData> {
  return request(`/salesman/analytics?${new URLSearchParams({from,to,period})}`);
}
