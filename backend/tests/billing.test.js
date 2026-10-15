import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBill, GSTIN_PATTERN, invoiceDate } from '../billing.js';
for (const [amount,rounded] of [[0,0],[49,0],[50,100],[12535,12500],[12549,12500],[12550,12600],[12599,12600],[25060,25100],[49980,50000]]) {
  test(`payable rounds ${amount} paise to ${rounded}`, () => {
    assert.deepEqual(calculateBill(amount),{totalAmountPaise:rounded});
  });
}
test('rejects invalid monetary amounts',()=>{
  for (const value of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>calculateBill(value));
});
test('GSTIN structure validation',()=>{
  assert.ok(GSTIN_PATTERN.test('27ABCDE1234F1Z5'));
  for (const value of ['123456789012345','27ABCDE1234F0Z5','27ABCDE1234F1X5','27abcde1234f1z5','27ABCDE1234F1Z']) assert.ok(!GSTIN_PATTERN.test(value));
});
test('invoice day switches at midnight in Kolkata',()=>{
  assert.equal(invoiceDate('2026-10-15T18:29:59.999Z'),'2026-10-15');
  assert.equal(invoiceDate('2026-10-15T18:30:00.000Z'),'2026-10-16');
});
