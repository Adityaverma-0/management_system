import { useMemo } from 'react';
import { Invoice, Customer } from '../../domain/types';
import { formatRupees } from '../../domain/money';

export default function CustomerWiseView({ invoices, customers }: { invoices: Invoice[], customers: Customer[] }) {
  const data = useMemo(() => {
    const map = new Map<string, {
      customer: Customer | null;
      billsCount: number;
      totalPurchased: number;
      creditGiven: number;
      name: string;
    }>();

    for (const inv of invoices) {
      if (inv.status !== 'VALID') continue;
      const cId = inv.customerId || 'walk-in';
      const d = map.get(cId) || {
        customer: customers.find(c => c.id === cId) || null,
        billsCount: 0,
        totalPurchased: 0,
        creditGiven: 0,
        name: inv.customerName || cId
      };
      d.billsCount++;
      d.totalPurchased += inv.totalAmountPaise;
      if (inv.paymentMode === 'CREDIT') d.creditGiven += inv.totalAmountPaise;
      map.set(cId, d);
    }
    
    return Array.from(map.values()).sort((a, b) => b.totalPurchased - a.totalPurchased);
  }, [invoices, customers]);

  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i} className="ui-card bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-bold">{d.name}</h4>
              {d.customer?.shopName && <p className="text-xs text-gray-500">{d.customer.shopName}</p>}
            </div>
            <div className="text-right">
              <p className="font-bold text-blue-600">{formatRupees(d.totalPurchased)}</p>
              <p className="text-xs font-bold text-gray-500">{d.billsCount} Bills</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
