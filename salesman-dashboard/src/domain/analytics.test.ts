import { describe, expect, it } from 'vitest';
import { pieSegments } from '../features/SalesAnalytics';

describe('analytics chart geometry', () => {
  it('keeps disjoint payment/status proportions and handles a full circle', () => {
    expect(pieSegments([0, 0])).toEqual([{ fraction: 0, offset: 0 }, { fraction: 0, offset: 0 }]);
    expect(pieSegments([75, 25, 0])).toEqual([{ fraction: .75, offset: 0 }, { fraction: .25, offset: .75 }, { fraction: 0, offset: 1 }]);
    expect(pieSegments([0, 10])[1]).toEqual({ fraction: 1, offset: 0 });
  });
});
