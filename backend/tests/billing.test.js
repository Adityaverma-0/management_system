import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBill, taxPaise } from '../billing.js';
for (const [original, expected] of [[12535,12500],[12549,12500],[12550,12600],[12599,12600],[25060,25100],[49980,50000]]) {
  test(`round ${original} paise to ${expected}`, () => {
    const bill=calculateBill(original);
    assert.equal(bill.totalAmountPaise,expected);
    assert.equal(original+bill.roundOffPaise,expected);
  });
}
test('configured decimal tax rates retain paise and half-up ties',()=>{
 assert.equal(taxPaise(100,2.5),3);
 assert.deepEqual(calculateBill(10001,2.5,9),{subtotalPaise:10001,cgstAmountPaise:250,sgstAmountPaise:900,unroundedTotalPaise:11151,totalAmountPaise:11200,roundOffPaise:49});
 assert.throws(()=>calculateBill(Number.MAX_SAFE_INTEGER,100,100));
 assert.throws(()=>calculateBill(-1));
 assert.throws(()=>taxPaise(100,'invalid'));
});
