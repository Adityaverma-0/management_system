import { beforeEach, expect, it, vi } from 'vitest';
const { request, getAll, db } = vi.hoisted(() => {
  const getAll = vi.fn();
  return { request: vi.fn(), getAll, db: {getAll,transaction:vi.fn()} };
});
vi.mock('./db',()=>({ getDB:async()=>db }));
vi.mock('./apiClient',()=>({request,session:()=>({user:{id:'s'}}),acknowledge:vi.fn()}));
vi.mock('./catalog',()=>({setCatalog:vi.fn()}));
const closed = {workDayId:'closed',state:'CLOSED',openedAt:2,totalSalesPaise:12535};
const snapshot = { products:[],ledger:[],loads:[],invoices:[],workDays:[closed],customers:[],accounting:[],outlets:[] };
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();
  db.transaction.mockReturnValue({objectStore:()=>({clear:async()=>{},put:async()=>{}}),done:Promise.resolve()});
  request.mockResolvedValue(snapshot);getAll.mockResolvedValue([closed]);
});
it('refreshing an approved day keeps its totals without opening a new work day',async()=>{
  const {fetchActiveWorkDay}=await import('./realApi');
  expect(await fetchActiveWorkDay()).toEqual(closed);
  expect(request.mock.calls.every(([path])=>path==='/salesman/snapshot')).toBe(true);
});
it('explicit Start New Day opens a new day and returns refreshed state',async()=>{
  const fresh={workDayId:'new',state:'NOT_STARTED',openedAt:3,totalSalesPaise:0};
  getAll.mockResolvedValue([closed,fresh]);
  const {startNewWorkDay}=await import('./realApi');
  expect(await startNewWorkDay()).toEqual(fresh);
  expect(request).toHaveBeenCalledWith('/salesman/work-days',{},true);
});
