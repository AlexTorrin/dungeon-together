import { describe, expect, it } from 'vitest';
import { chebyshev } from './geometry';

describe('chebyshev', () => {
  it('counts diagonal steps as one', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
    expect(chebyshev({ x: 0, y: 0 }, { x: 4, y: 1 })).toBe(4);
    expect(chebyshev({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});
