/**
 * Детерминированный генератор случайных чисел (mulberry32), который живёт в GameState.
 *
 * Состояние генератора — одно 32-битное число. Каждый бросок — чистая функция:
 * принимает состояние и возвращает [результат, новое состояние], которое нужно записать
 * обратно в GameState. Одинаковый seed + одинаковые команды → одинаковая игра.
 */
export type RngState = number;

/** Любое число → валидное состояние генератора (uint32). NaN и дробная часть отбрасываются. */
export function seedRng(seed: number): RngState {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

/** Число в [0, 1). */
export function nextFloat(rng: RngState): readonly [number, RngState] {
  const next = (rng + 0x6d2b79f5) >>> 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Целое в [min, max] включительно. */
export function nextInt(rng: RngState, min: number, max: number): readonly [number, RngState] {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`Bad range [${min}, ${max}]`);
  }
  const [value, next] = nextFloat(rng);
  return [min + Math.floor(value * (max - min + 1)), next];
}

/** true с вероятностью probability (0 — никогда, 1 — всегда). */
export function chance(rng: RngState, probability: number): readonly [boolean, RngState] {
  const [value, next] = nextFloat(rng);
  return [value < probability, next];
}
