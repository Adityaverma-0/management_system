import { useState, useEffect } from 'react';
import { WorkDay, Invoice, DayStockReportRow } from '../../domain/types';
import { formatRupees } from '../../domain/money';
import InvoicesView from './InvoicesView';
import CashBreakdownTable from '../CashBreakdownTable';
import StockSummaryTable from '../stock/StockSummaryTable';
import DayReportPrint from './DayReportPrint';
import { getDayStockReport } from '../../domain/dayStockReport';

export default function HistoryDayDetail({ day, invoices }: { day: WorkDay, invoices: Invoice[] }) {
  const [report, setReport] = useState<DayStockReportRow[]>([]);
  
  useEffect(() => {
    getDayStockReport(day.workDayId).then(setReport);
  }, [day.workDayId]);

  const dayInvoices = invoices.filter(i => i.workDayId === day.workDayId);

  return (
    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-700 text-sm overflow-hidden">
      
      <div className="flex flex-wrap gap-2 justify-between items-center mb-4">
        <h3 className="font-bold text-lg">Day Details</h3>
        <button onClick={() => window.print()} className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1 rounded font-bold text-sm">
          Print Report
        </button>
      </div>
      <DayReportPrint day={day} report={report} />
      <div className="print:hidden">

      <div className="grid grid-cols-2 gap-2 mb-4 print:hidden">
        <div>
          <span className="text-gray-500 block text-xs">Total Sales</span>
          <span className="font-bold">{formatRupees(day.totalSalesPaise)}</span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Status</span>
          <span className="font-bold">{day.state}</span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">CASH</span>
          <span className="font-bold text-green-600">{formatRupees(day.cashSalesPaise)}</span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">UPI</span>
          <span className="font-bold text-blue-600">{formatRupees(day.upiSalesPaise)}</span>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">CREDIT</span>
          <span className="font-bold text-orange-600">{formatRupees(day.creditSalesPaise)}</span>
        </div>
      </div>

      {day.cashBreakdown && (
        <div className="mb-4">
          <CashBreakdownTable 
            breakdown={day.cashBreakdown}
            totalPaise={day.cashTotalPaise || 0}
            noteCount={day.noteCount || 0}
            coinCount={day.coinCount || 0}
          />
        </div>
      )}

      <div className="mb-4 -mx-3">
        <StockSummaryTable isPending={day.state !== "CLOSED" && day.state !== "APPROVED"} report={report} />
      </div>

      <h5 className="font-bold mb-2 ml-1">Invoices</h5>
      {dayInvoices.length === 0 ? (
        <p className="text-gray-500 ml-1">No invoices found for this day.</p>
      ) : (
        <InvoicesView invoices={dayInvoices} />
      )}
      </div>
    </div>
  );
}
