import { describe, expect, it } from 'vitest';
import { linePoints, pieSegments } from '../features/SalesAnalytics';

describe('analytics chart geometry', () => {
  it('handles empty, zero and single-point series without NaN', () => {
    expect(linePoints([])).toEqual([]);
    expect(linePoints([0])).toEqual([{ x: 300, y: 165 }]);
    expect(linePoints([100])).toEqual([{ x: 300, y: 30 }]);
    expect(linePoints([0, 100]).map(p => p.y)).toEqual([165, 30]);
  });
  it('keeps disjoint payment/status proportions and handles a full circle', () => {
    expect(pieSegments([0, 0])).toEqual([{ fraction: 0, offset: 0 }, { fraction: 0, offset: 0 }]);
    expect(pieSegments([75, 25, 0])).toEqual([{ fraction: .75, offset: 0 }, { fraction: .25, offset: .75 }, { fraction: 0, offset: 1 }]);
    expect(pieSegments([0, 10])[1]).toEqual({ fraction: 1, offset: 0 });
  });
});
