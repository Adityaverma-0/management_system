import React, { useState, useMemo } from 'react';
import { DayStockReportRow } from '../../domain/types';

import { formatQuantity } from '../../domain/units';
import { CheckCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { formatRupees } from '../../domain/money';
import clsx from 'clsx';

interface Props {
  report: DayStockReportRow[];
  isPending?: boolean;
  printMode?: 'none' | 'a4' | '80mm';
}

type SortField = 'name' | 'soldAmount' | 'remainingAmount';

const defaultProduct = { id: 'unknown', name: 'unknown', pricePaise: 0, unitsPerStrip: 1, stripsPerBox: 1, piecesPerBox: 1 };

// Memoized individual table row
const StockSummaryTableRow = React.memo(({ row, product, price, isDiff, difference, startPieces, startHeld, startLoaded, soldPieces, soldAmount, remTotal, remGodown, remVehicle, remAmount, godownLabel, vehicleLabel }: any) => (
  <tr className={clsx("hover:bg-gray-50 dark:hover:bg-gray-800/50", isDiff && "bg-red-50 dark:bg-red-900/10")}>
    <td className="p-3 sticky left-0 bg-inherit z-10 shadow-[1px_0_0_0_#e5e7eb] dark:shadow-[1px_0_0_0_#374151] align-top">
      <div className="font-bold text-gray-900 dark:text-gray-100">{row.productName}</div>
      {isDiff ? (
        <div className="mt-1 flex items-center text-xs font-bold text-red-600 dark:text-red-400">
          <AlertTriangle size={12} className="mr-1" />
          {difference > 0 ? `Excess: ${formatQuantity(difference, product)}` : `Short: ${formatQuantity(Math.abs(difference), product)}`}
        </div>
      ) : (
        <div className="mt-1 flex items-center text-xs text-green-600 dark:text-green-500">
          <CheckCircle size={12} className="mr-1" /> OK
        </div>
      )}
    </td>
    <td className="p-3 align-top whitespace-nowrap">
      <div className="font-medium text-gray-900 dark:text-gray-100">{formatQuantity(startPieces, product)}</div>
      <div className="text-gray-500">{formatRupees(startPieces * price)}</div>
      <div className="text-[10px] text-gray-400 mt-1">Carried {formatQuantity(startHeld, product)} + Loaded {formatQuantity(startLoaded, product)}</div>
    </td>
    <td className="p-3 align-top whitespace-nowrap">
      <div className="font-medium text-gray-900 dark:text-gray-100">{formatQuantity(soldPieces, product)}</div>
      <div className="text-gray-500">{formatRupees(soldAmount)}</div>
    </td>
    <td className="p-3 align-top whitespace-nowrap text-right">
      <div className="font-medium text-gray-900 dark:text-gray-100">{formatQuantity(remTotal, product)}</div>
      <div className="text-gray-500">{formatRupees(remAmount)}</div>
      <div className="text-[10px] text-gray-400 mt-1 flex justify-end gap-2">
        <span className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{godownLabel}: {formatQuantity(remGodown, product)}</span>
        <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1 rounded">{vehicleLabel}: {formatQuantity(remVehicle, product)}</span>
      </div>
    </td>
  </tr>
));

const StockSummaryTable = React.memo(({ report, isPending = false, printMode = 'none' }: Props) => {
  const [showAll, setShowAll] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    return report.filter(row => {
      if (showAll) return true;
      const start = (row.startFromHeldPieces || 0) + (row.startLoadedPieces || 0);
      const sold = row.soldPieces || 0;
      const rem = (row.remainingToGodownPieces || 0) + (row.remainingHeldInVehiclePieces || 0);
      return start > 0 || sold > 0 || rem > 0;
    });
  }, [report, showAll]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let valA = 0, valB = 0;
      if (sortField === 'name') {
        return sortAsc ? a.productName.localeCompare(b.productName) : b.productName.localeCompare(a.productName);
      } else if (sortField === 'soldAmount') {
        valA = a.soldAmountPaise || 0; valB = b.soldAmountPaise || 0;
      } else if (sortField === 'remainingAmount') {
        const pA = a.priceSnapshotPaise || 0; const pB = b.priceSnapshotPaise || 0;
        valA = ((a.remainingToGodownPieces || 0) + (a.remainingHeldInVehiclePieces || 0)) * pA;
        valB = ((b.remainingToGodownPieces || 0) + (b.remainingHeldInVehiclePieces || 0)) * pB;
      }
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [filtered, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const { totalStartPaise, totalSoldPaise, totalRemPaise, totalGodownPaise, totalVehiclePaise, totalItemsSold } = useMemo(() => {
    let ts = 0, tso = 0, tr = 0, tg = 0, tv = 0, ti = 0;
    for (const r of filtered) {
      const price = r.priceSnapshotPaise || 0;
      const startPieces = (r.startFromHeldPieces || 0) + (r.startLoadedPieces || 0);
      const remGodown = r.remainingToGodownPieces || 0;
      const remVehicle = r.remainingHeldInVehiclePieces || 0;
      const remTotal = remGodown + remVehicle;
      
      ts += startPieces * price;
      tso += r.soldAmountPaise || 0;
      tr += remTotal * price;
      tg += remGodown * price;
      tv += remVehicle * price;
      ti += r.soldPieces || 0;
    }
    return { totalStartPaise: ts, totalSoldPaise: tso, totalRemPaise: tr, totalGodownPaise: tg, totalVehiclePaise: tv, totalItemsSold: ti };
  }, [filtered]);

  const godownLabel = isPending ? 'To Godown' : 'Returned to Godown';
  const vehicleLabel = isPending ? 'Stay in Vehicle' : 'Held in Vehicle';

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortAsc ? <ChevronUp size={14} className="inline ml-1" /> : <ChevronDown size={14} className="inline ml-1" />;
  };

  if (printMode === '80mm') {
    return (
      <div className="text-[11px] font-mono leading-tight">
        <div className="font-bold border-b border-black border-dashed pb-1 mb-1 text-center">STOCK SUMMARY</div>
        {sorted.map(row => {
          const product = (row as DayStockReportRow & { product?: typeof defaultProduct }).product || defaultProduct;
          const startPieces = (row.startFromHeldPieces || 0) + (row.startLoadedPieces || 0);
          const soldPieces = row.soldPieces || 0;
          const remGodown = row.remainingToGodownPieces || 0;
          const remVehicle = row.remainingHeldInVehiclePieces || 0;
          return (
            <div key={row.productId} className="mb-2 border-b border-dashed border-gray-300 pb-1">
              <div className="font-bold">{row.productName}</div>
              <div className="flex justify-between pl-2">
                <span>St: {formatQuantity(startPieces, product)}</span>
                <span>Sd: {formatQuantity(soldPieces, product)}</span>
              </div>
              <div className="flex justify-between pl-2">
                <span>Gd: {formatQuantity(remGodown, product)}</span>
                <span>Vh: {formatQuantity(remVehicle, product)}</span>
              </div>
            </div>
          );
        })}
        <div className="border-t border-dashed border-black pt-1 mt-1 font-bold">
          <div className="flex justify-between"><span>Start:</span> <span>{formatRupees(totalStartPaise)}</span></div>
          <div className="flex justify-between"><span>Sold:</span> <span>{formatRupees(totalSoldPaise)}</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full text-sm">
      <div className="ui-card overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <table className="ui-stock-table w-full text-left border-collapse">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th scope="col" className="p-3 sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 font-bold border-b border-gray-200 dark:border-gray-700 shadow-[1px_0_0_0_#e5e7eb] dark:shadow-[1px_0_0_0_#374151] cursor-pointer" aria-sort={sortField === 'name' ? (sortAsc ? 'ascending' : 'descending') : 'none'}><button type="button" className="ui-sort" onClick={() => handleSort('name')}>
                ITEM <SortIcon field="name" />
              </button></th>
              <th scope="col" className="p-3 border-b border-gray-200 dark:border-gray-700">
                TOTAL STOCK AT START
              </th>
              <th scope="col" className="p-3 border-b border-gray-200 dark:border-gray-700 cursor-pointer" aria-sort={sortField === 'soldAmount' ? (sortAsc ? 'ascending' : 'descending') : 'none'}><button type="button" className="ui-sort" onClick={() => handleSort('soldAmount')}>
                SOLD <SortIcon field="soldAmount" />
              </button></th>
              <th scope="col" className="p-3 border-b border-gray-200 dark:border-gray-700 cursor-pointer text-right" aria-sort={sortField === 'remainingAmount' ? (sortAsc ? 'ascending' : 'descending') : 'none'}><button type="button" className="ui-sort" onClick={() => handleSort('remainingAmount')}>
                REMAINING <SortIcon field="remainingAmount" />
              </button></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {sorted.map(row => {
              const product = (row as DayStockReportRow & { product?: typeof defaultProduct }).product || defaultProduct;
              const price = row.priceSnapshotPaise || 0;
              const startHeld = row.startFromHeldPieces || 0;
              const startLoaded = row.startLoadedPieces || 0;
              const startPieces = startHeld + startLoaded;
              const soldPieces = row.soldPieces || 0;
              const soldAmount = row.soldAmountPaise || 0;
              const remGodown = row.remainingToGodownPieces || 0;
              const remVehicle = row.remainingHeldInVehiclePieces || 0;
              const remTotal = remGodown + remVehicle;
              const remAmount = remTotal * price;
              const expected = startPieces - soldPieces;
              const difference = (row.countedRemaining ?? remTotal) - expected;
              const isDiff = difference !== 0;
              
              return (
                <StockSummaryTableRow
                  key={row.productId}
                  row={row} product={product} price={price} isDiff={isDiff} difference={difference}
                  startPieces={startPieces} startHeld={startHeld} startLoaded={startLoaded}
                  soldPieces={soldPieces} soldAmount={soldAmount}
                  remTotal={remTotal} remGodown={remGodown} remVehicle={remVehicle} remAmount={remAmount}
                  godownLabel={godownLabel} vehicleLabel={vehicleLabel}
                />
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500">No stock data available</td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 font-bold text-gray-900 dark:text-gray-100">
            <tr>
              <td className="p-3 sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 shadow-[1px_0_0_0_#e5e7eb] dark:shadow-[1px_0_0_0_#374151]">Totals</td>
              <td className="p-3">{formatRupees(totalStartPaise)}</td>
              <td className="p-3">{formatRupees(totalSoldPaise)}</td>
              <td className="p-3 text-right">
                {formatRupees(totalRemPaise)}
                <div className="text-xs text-gray-500 font-normal mt-1 flex justify-end gap-2">
                  <span>{godownLabel}: {formatRupees(totalGodownPaise)}</span>
                  <span>{vehicleLabel}: {formatRupees(totalVehiclePaise)}</span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 justify-between items-center text-xs text-gray-500">
        <div>Products: {sorted.length} · Items Sold: {formatQuantity(totalItemsSold, defaultProduct).replace(/[a-zA-Z]/g, '').trim()}</div>
        <button onClick={() => setShowAll(!showAll)} className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
          {showAll ? 'Hide zero-activity products' : 'Show all products'}
        </button>
      </div>
    </div>
  );
});

export default StockSummaryTable;
