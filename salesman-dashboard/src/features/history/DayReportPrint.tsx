import { WorkDay, DayStockReportRow } from '../../domain/types';
import { formatRupees } from '../../domain/money';
import StockSummaryTable from '../stock/StockSummaryTable';

export default function DayReportPrint({ day, report }: { day: WorkDay, report: DayStockReportRow[] }) {
  const dDate = new Date(day.openedAt);
  const dateDisplay = dDate.toLocaleDateString();

  return (
    <div data-print-target="day-report" className="hidden print:block text-black bg-white">
      {/* A4 Layout */}
      <div data-print-day-page className="hidden sm:print:block p-8">
        <h1 className="text-2xl font-bold mb-4 text-center">Day Summary Report</h1>
        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div><strong>Salesman:</strong> {day.salesmanId}</div>
          <div><strong>Vehicle:</strong> {day.vehicleId}</div>
          <div><strong>Date:</strong> {dateDisplay}</div>
          <div><strong>Status:</strong> {day.state}</div>
        </div>
        
        <div className="mb-6">
          <StockSummaryTable report={report} printMode="a4" isPending={day.state !== 'CLOSED' && day.state !== 'APPROVED'} />
        </div>
        
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div>
            <h3 className="font-bold border-b border-black mb-2">Sales Totals</h3>
            <div className="flex justify-between"><span>CASH:</span> <span>{formatRupees(day.cashSalesPaise)}</span></div>
            <div className="flex justify-between"><span>UPI:</span> <span>{formatRupees(day.upiSalesPaise)}</span></div>
            <div className="flex justify-between"><span>CREDIT:</span> <span>{formatRupees(day.creditSalesPaise)}</span></div>
            <div className="flex justify-between font-bold mt-2"><span>TOTAL:</span> <span>{formatRupees(day.totalSalesPaise)}</span></div>
          </div>
        </div>
      </div>

      {/* 80mm Thermal Receipt Layout */}
      <div data-print-day-thermal className="sm:print:hidden w-[80mm] text-[11px] leading-tight font-mono mx-auto">
        <div className="text-center font-bold mb-2 pb-1 border-b border-black">
          <div className="text-sm">DAY REPORT</div>
          <div>{dateDisplay}</div>
        </div>
        
        <div className="mb-2">
          <div>SM: {day.salesmanId}</div>
          <div>VEH: {day.vehicleId}</div>
        </div>
        
        <div className="mb-2 pb-2">
          <StockSummaryTable report={report} printMode="80mm" />
        </div>

        <div className="mb-2 pb-2 border-b border-black border-dashed">
          <div className="flex justify-between"><span>CASH:</span> <span>{formatRupees(day.cashSalesPaise)}</span></div>
          <div className="flex justify-between"><span>UPI:</span> <span>{formatRupees(day.upiSalesPaise)}</span></div>
          <div className="flex justify-between"><span>CREDIT:</span> <span>{formatRupees(day.creditSalesPaise)}</span></div>
          <div className="flex justify-between font-bold mt-1"><span>TOTAL:</span> <span>{formatRupees(day.totalSalesPaise)}</span></div>
        </div>
        <div className="text-center mt-4">--- END OF REPORT ---</div>
      </div>
    </div>
  );
}
