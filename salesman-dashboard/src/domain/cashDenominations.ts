// Constants for REQUIRE_DENOMINATIONS
export const REQUIRE_DENOMINATIONS = true;

export type DenominationKey = 
  | 'NOTE_500' | 'NOTE_200' | 'NOTE_100' | 'NOTE_50' | 'NOTE_20' | 'NOTE_10'
  | 'COIN_10' | 'COIN_5' | 'COIN_2' | 'COIN_1';

export type DenominationType = 'NOTE' | 'COIN';

export interface DenominationConfig {
  key: DenominationKey;
  label: string;
  valueRupees: number;
  type: DenominationType;
}

export const DENOMINATIONS: DenominationConfig[] = [
  { key: 'NOTE_500', label: 'Rs 500 note', valueRupees: 500, type: 'NOTE' },
  { key: 'NOTE_200', label: 'Rs 200 note', valueRupees: 200, type: 'NOTE' },
  { key: 'NOTE_100', label: 'Rs 100 note', valueRupees: 100, type: 'NOTE' },
  { key: 'NOTE_50', label: 'Rs 50 note', valueRupees: 50, type: 'NOTE' },
  { key: 'NOTE_20', label: 'Rs 20 note', valueRupees: 20, type: 'NOTE' },
  { key: 'NOTE_10', label: 'Rs 10 note', valueRupees: 10, type: 'NOTE' },
  { key: 'COIN_10', label: 'Rs 10 coin', valueRupees: 10, type: 'COIN' },
  { key: 'COIN_5', label: 'Rs 5 coin', valueRupees: 5, type: 'COIN' },
  { key: 'COIN_2', label: 'Rs 2 coin', valueRupees: 2, type: 'COIN' },
  { key: 'COIN_1', label: 'Rs 1 coin', valueRupees: 1, type: 'COIN' }
];

/**
 * Calculates the exact total in paise from a breakdown map of counts.
 * It also returns the number of notes and coins.
 * Uses a single O(1) calculation for each row in the map.
 */
export function calculateBreakdownTotal(breakdown: Record<string, number>) {
  let totalPaise = breakdown.PAISE || 0;
  let noteCount = 0;
  let coinCount = 0;

  for (const denom of DENOMINATIONS) {
    const count = breakdown[denom.key] || 0;
    if (count > 0) {
      totalPaise += count * denom.valueRupees * 100;
      if (denom.type === 'NOTE') {
        noteCount += count;
      } else {
        coinCount += count;
      }
    }
  }

  return { totalPaise, noteCount, coinCount };
}

/**
 * Validates a user-entered count. Must be a whole number between 0 and 9999.
 */
export function validateBreakdownCount(count: number): boolean {
  if (!Number.isInteger(count)) return false;
  if (count < 0 || count > 9999) return false;
  return true;
}

/**
 * Validates the full breakdown map. All values must be valid counts.
 */
export function validateBreakdown(breakdown: Record<string, number>): boolean {
  for (const val of Object.values(breakdown)) {
    if (!validateBreakdownCount(val)) return false;
  }
  return true;
}

/**
 * Compares the total cash from the breakdown with the expected cash.
 * Returns the exact difference in paise and a string representation of the status.
 */
export function compareWithExpectedCash(breakdownTotalPaise: number, expectedCashPaise: number) {
  const differencePaise = breakdownTotalPaise - expectedCashPaise;
  let status: 'MATCH' | 'SHORT' | 'EXCESS' = 'MATCH';
  
  if (differencePaise < 0) {
    status = 'SHORT';
  } else if (differencePaise > 0) {
    status = 'EXCESS';
  }

  return { differencePaise, status };
}
