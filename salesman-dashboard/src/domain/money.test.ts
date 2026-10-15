import { expect, it } from 'vitest';
import { roundPayablePaise } from './money';
it('rounds the final payable at the half-rupee boundary', () => {
  expect(roundPayablePaise(12535)).toBe(12500);
  expect(roundPayablePaise(12549)).toBe(12500);
  expect(roundPayablePaise(12550)).toBe(12600);
  expect(roundPayablePaise(12599)).toBe(12600);
  // Sum first: rounding each of two lines would produce a different payable.
  expect(roundPayablePaise(12535 + 12535)).toBe(25100);
});
it('rejects invalid and overflowing payable amounts', () => {
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    expect(() => roundPayablePaise(value)).toThrow();
  }
});
