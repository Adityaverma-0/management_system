import { useState, useEffect, useMemo } from 'react';
import { Invoice, WorkDay, Customer } from '../../domain/types';
import { queryInvoicesByDateRange, queryWorkDaysByDateRange } from '../../data/queryApi';
import { getCustomers } from '../../data/mockApi';
import { formatRupees } from '../../domain/money';
import { Calendar, Filter, Users, Receipt } from 'lucide-react';
import DayWiseView from './DayWiseView';
import CustomerWiseView from './CustomerWiseView';
import InvoicesView from './InvoicesView';

export type HistoryViewMode = 'DAY' | 'CUSTOMER' | 'INVOICES';

export interface FilterState {
  dateRange: { start: string; end: string; label: string };
  customerId: string | null;
  paymentModes: string[];
  billStatus: 'VALID' | 'VOID' | 'ALL';
  amountMin: string;
  amountMax: string;
  invoiceSearch: string;
}

const getLast30Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    label: 'Last 30 Days'
  };
};

import { useSearchParams } from 'react-router-dom';

export default function HistoryView() {
  const [searchParams, setSearchParams] = useSearchParams();
  
  const [viewMode, setViewMode] = useState<HistoryViewMode>(
    (searchParams.get('mode') as HistoryViewMode) || 'DAY'
  );
  
  const [filters, setFiltersState] = useState<FilterState>(() => {
    return {
      dateRange: getLast30Days(),
      customerId: searchParams.get('customer') || null,
      paymentModes: searchParams.get('modes') ? searchParams.get('modes')!.split(',') : [],
      billStatus: (searchParams.get('status') as any) || 'VALID',
      amountMin: searchParams.get('min') || '',
      amountMax: searchParams.get('max') || '',
      invoiceSearch: searchParams.get('q') || ''
    };
  });

  const setFilters = (f: FilterState | ((prev: FilterState) => FilterState)) => {
    setFiltersState(prev => {
      const next = typeof f === 'function' ? f(prev) : f;
      const params = new URLSearchParams(searchParams);
      if (next.customerId) params.set('customer', next.customerId); else params.delete('customer');
      if (next.paymentModes.length) params.set('modes', next.paymentModes.join(',')); else params.delete('modes');
      if (next.billStatus !== 'VALID') params.set('status', next.billStatus); else params.delete('status');
      if (next.amountMin) params.set('min', next.amountMin); else params.delete('min');
      if (next.amountMax) params.set('max', next.amountMax); else params.delete('max');
      if (next.invoiceSearch) params.set('q', next.invoiceSearch); else params.delete('q');
      params.set('mode', viewMode);
      setSearchParams(params, { replace: true });
      return next;
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.set('mode', viewMode);
    setSearchParams(params, { replace: true });
  }, [viewMode]);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [workDays, setWorkDays] = useState<WorkDay[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // Load data based on date range (from IDB)
  useEffect(() => {
    setLoading(true);
    const start = performance.now();
    Promise.all([
      queryInvoicesByDateRange(filters.dateRange.start, filters.dateRange.end),
      queryWorkDaysByDateRange(filters.dateRange.start, filters.dateRange.end),
      getCustomers()
    ]).then(([invs, wds, custs]) => {
      setInvoices(invs);
      setWorkDays(wds);
      setCustomers(custs);
      setLoading(false);
      console.log(`Loaded ${invs.length} invoices in ${performance.now() - start}ms`);
    });
  }, [filters.dateRange]);

  // Apply in-memory filters
  const filteredInvoices = useMemo(() => {
    const start = performance.now();
    let res = invoices;

    if (filters.billStatus !== 'ALL') {
      res = res.filter(i => i.status === filters.billStatus);
    }
    if (filters.customerId) {
      res = res.filter(i => i.customerId === filters.customerId);
    }
    if (filters.paymentModes.length > 0) {
      res = res.filter(i => filters.paymentModes.includes(i.paymentMode));
    }
    if (filters.amountMin) {
      const min = parseFloat(filters.amountMin) * 100;
      if (!isNaN(min)) res = res.filter(i => i.totalAmountPaise >= min);
    }
    if (filters.amountMax) {
      const max = parseFloat(filters.amountMax) * 100;
      if (!isNaN(max)) res = res.filter(i => i.totalAmountPaise <= max);
    }
    if (filters.invoiceSearch) {
      const q = filters.invoiceSearch.toLowerCase();
      res = res.filter(i => i.invoiceNumber.toLowerCase().includes(q));
    }
    console.log(`Filtered to ${res.length} invoices in ${performance.now() - start}ms`);
    return res;
  }, [invoices, filters]);

  // Compute totals
  const totals = useMemo(() => {
    let sales = 0;
    let cash = 0;
    let upi = 0;
    let credit = 0;
    let items = 0;
    const custSet = new Set<string>();

    for (const inv of filteredInvoices) {
      if (inv.status === 'VALID') {
        sales += inv.totalAmountPaise;
        if (inv.paymentMode === 'CASH') cash += inv.totalAmountPaise;
        else if (inv.paymentMode === 'UPI') upi += inv.totalAmountPaise;
        else if (inv.paymentMode === 'CREDIT') credit += inv.totalAmountPaise;
        
        if (inv.customerId) custSet.add(inv.customerId);
        items += inv.items.reduce((sum, item) => sum + item.quantityPieces, 0);
      }
    }

    return { sales, cash, upi, credit, bills: filteredInvoices.length, customers: custSet.size, items };
  }, [filteredInvoices]);

  return (
    <div className="flex flex-col space-y-4">
      {/* Segmented Control */}
      <div className="flex bg-gray-200 dark:bg-gray-800 p-1 rounded-lg">
        <button 
          aria-pressed={viewMode === 'DAY'} onClick={() => setViewMode('DAY')}
          className={`flex-1 py-2 text-sm font-bold rounded-md flex flex-col sm:flex-row gap-1 items-center justify-center ${viewMode === 'DAY' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}
        ><Calendar size={16} className="shrink-0 sm:mr-1"/> Day-wise</button>
        <button 
          aria-pressed={viewMode === 'CUSTOMER'} onClick={() => setViewMode('CUSTOMER')}
          className={`flex-1 py-2 text-sm font-bold rounded-md flex flex-col sm:flex-row gap-1 items-center justify-center ${viewMode === 'CUSTOMER' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}
        ><Users size={16} className="shrink-0 sm:mr-1"/> Customer</button>
        <button 
          aria-pressed={viewMode === 'INVOICES'} onClick={() => setViewMode('INVOICES')}
          className={`flex-1 py-2 text-sm font-bold rounded-md flex flex-col sm:flex-row gap-1 items-center justify-center ${viewMode === 'INVOICES' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}
        ><Receipt size={16} className="shrink-0 sm:mr-1"/> Invoices</button>
      </div>

      {/* Filter Bar */}
      <div className="ui-card bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col space-y-3">
        <div className="flex justify-between items-center">
          <div className="text-sm font-bold text-gray-700 dark:text-gray-300">
            {filteredInvoices.length} Bills | {formatRupees(totals.sales)}
          </div>
          <button aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)} className="flex items-center text-blue-600 text-sm font-bold bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg">
            <Filter size={16} className="mr-1" /> Filters
          </button>
        </div>
        
        {showFilters && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-3 text-sm">
            {/* Extremely simplified filter UI for MVP, real would use a bottom sheet component */}
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Bill status"
                className="border p-2 rounded bg-gray-50 dark:bg-gray-900"
                value={filters.billStatus}
                onChange={e => setFilters({...filters, billStatus: e.target.value as any})}
              >
                <option value="VALID">VALID ONLY</option>
                <option value="VOID">VOID ONLY</option>
                <option value="ALL">ALL BILLS</option>
              </select>
              
              <button 
                onClick={() => setFilters({
                  dateRange: getLast30Days(),
                  customerId: null,
                  paymentModes: [],
                  billStatus: 'VALID',
                  amountMin: '',
                  amountMax: '',
                  invoiceSearch: ''
                })}
                className="text-red-500 font-bold"
              >
                Reset Filters
              </button>
            </div>
            <input aria-label="Search Invoice Number..."
              type="text"
              placeholder="Search Invoice Number..."
              className="w-full border p-2 rounded bg-gray-50 dark:bg-gray-900"
              value={filters.invoiceSearch}
              onChange={e => setFilters({...filters, invoiceSearch: e.target.value})}
            />
          </div>
        )}
      </div>

      {/* Main Views */}
      {loading ? (
        <div className="text-center p-8 text-gray-500">Loading history...</div>
      ) : filteredInvoices.length === 0 ? (
        <div className="ui-card text-center p-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          <p className="text-gray-500 font-bold">No bills for these filters.</p>
          <button 
            onClick={() => setFilters({
              dateRange: getLast30Days(),
              customerId: null,
              paymentModes: [],
              billStatus: 'VALID',
              amountMin: '',
              amountMax: '',
              invoiceSearch: ''
            })}
            className="mt-3 text-blue-600 font-bold text-sm"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="min-h-[50vh]">
          {viewMode === 'DAY' && <DayWiseView invoices={filteredInvoices} workDays={workDays} />}
          {viewMode === 'CUSTOMER' && <CustomerWiseView invoices={filteredInvoices} customers={customers} />}
          {viewMode === 'INVOICES' && <InvoicesView invoices={filteredInvoices} />}
        </div>
      )}
    </div>
  );
}
