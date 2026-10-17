/** Баночка лечения. */
export const POTION = {
  /** Сколько ОД стоит выпить. Больше 1 — как замах: лечит в последней фазе. */
  cost: 2,
  /** Какую долю максимума HP возвращает (округление вниз), но не выше максимума. */
  healShare: 0.5,
} as const;

/** Сколько HP вернёт баночка актору с таким максимумом. */
export function potionHeal(maxHp: number): number {
  return Math.floor(maxHp * POTION.healShare);
}
