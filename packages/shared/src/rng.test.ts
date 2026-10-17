import { describe, expect, it } from 'vitest';
import { chance, nextFloat, nextInt, seedRng, type RngState } from './rng';

/** n бросков подряд, протаскивая состояние, как это делает игровая логика. */
function rolls<T>(seed: number, n: number, roll: (rng: RngState) => readonly [T, RngState]): T[] {
  const result: T[] = [];
  let rng = seedRng(seed);
  for (let i = 0; i < n; i++) {
    const [value, next] = roll(rng);
    result.push(value);
    rng = next;
  }
  return result;
}

describe('seedRng', () => {
  it('normalizes any number to uint32', () => {
    expect(seedRng(42)).toBe(42);
    expect(seedRng(-1)).toBe(4294967295);
    expect(seedRng(2 ** 32 + 5)).toBe(5);
    expect(seedRng(3.9)).toBe(3);
    expect(seedRng(Number.NaN)).toBe(0);
    expect(seedRng(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('nextFloat', () => {
  it('is deterministic: the same seed gives the same sequence', () => {
    expect(rolls(123, 20, nextFloat)).toEqual(rolls(123, 20, nextFloat));
  });

  it('different seeds give different sequences', () => {
    expect(rolls(1, 5, nextFloat)).not.toEqual(rolls(2, 5, nextFloat));
  });

  it('is pure: rolling the same state twice gives the same result', () => {
    const rng = seedRng(99);
    expect(nextFloat(rng)).toEqual(nextFloat(rng));
    expect(nextFloat(rng)[1]).not.toBe(rng);
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const values = rolls(7, 10_000, nextFloat);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('pins the sequence: changing the algorithm breaks saved seeds and replays', () => {
    expect(rolls(42, 3, nextFloat).map((v) => v.toFixed(6))).toMatchInlineSnapshot(`
      [
        "0.601104",
        "0.448291",
        "0.852466",
      ]
    `);
  });
});

describe('nextInt', () => {
  it('covers the whole inclusive range and nothing outside it', () => {
    const values = rolls(5, 2_000, (rng) => nextInt(rng, 1, 6));
    expect(new Set(values)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('works for a single-value range', () => {
    expect(nextInt(seedRng(1), 3, 3)[0]).toBe(3);
  });

  it('rejects bad ranges', () => {
    expect(() => nextInt(seedRng(1), 5, 1)).toThrow(/Bad range/);
    expect(() => nextInt(seedRng(1), 0.5, 2)).toThrow(/Bad range/);
  });
});

describe('chance', () => {
  it('never fires at 0 and always fires at 1', () => {
    expect(rolls(3, 200, (rng) => chance(rng, 0)).some(Boolean)).toBe(false);
    expect(rolls(3, 200, (rng) => chance(rng, 1)).every(Boolean)).toBe(true);
  });

  it('fires about as often as asked', () => {
    const hits = rolls(11, 10_000, (rng) => chance(rng, 0.3)).filter(Boolean).length;
    expect(hits / 10_000).toBeGreaterThan(0.28);
    expect(hits / 10_000).toBeLessThan(0.32);
  });
});
