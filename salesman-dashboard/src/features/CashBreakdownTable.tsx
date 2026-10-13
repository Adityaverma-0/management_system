import { DENOMINATIONS } from '../domain/cashDenominations';
import { formatRupees } from '../domain/money';

interface CashBreakdownTableProps {
  breakdown: Record<string, number>;
  totalPaise: number;
  noteCount: number;
  coinCount: number;
}

export default function CashBreakdownTable({ breakdown, totalPaise, noteCount, coinCount }: CashBreakdownTableProps) {
  const items = DENOMINATIONS.map(d => ({
    ...d,
    count: breakdown[d.key] || 0
  })).filter(d => d.count > 0);

  return (
    <div className="w-full text-sm">
      <div className="ui-table-scroll"><table className="w-full text-left border-collapse">
        <thead className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 uppercase text-xs">
          <tr>
            <th className="p-2 border-b border-gray-200 dark:border-gray-700">Denomination</th>
            <th className="p-2 border-b border-gray-200 dark:border-gray-700 text-right">Count</th>
            <th className="p-2 border-b border-gray-200 dark:border-gray-700 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-900 dark:text-gray-100">
          {items.map((item, idx) => (
            <tr key={item.key} className={idx % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800'}>
              <td className="p-2">{item.label}</td>
              <td className="p-2 text-right">{item.count}</td>
              <td className="p-2 text-right">{formatRupees(item.count * (item.valueRupees * 100))}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={3} className="p-4 text-center text-gray-500">No cash data</td>
            </tr>
          )}
        </tbody>
        <tfoot className="bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-bold">
          <tr>
            <td className="p-2">Total</td>
            <td className="p-2 text-right text-xs font-normal text-gray-600 dark:text-gray-400">
              {noteCount} notes, {coinCount} coins
            </td>
            <td className="p-2 text-right">{formatRupees(totalPaise)}</td>
          </tr>
        </tfoot>
      </table></div>
    </div>
  );
}
