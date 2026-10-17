import type { Direction } from '@dt/shared';

export interface HeldArrows {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/**
 * Направление по зажатым клавишам: одна — прямо, две соседние — по диагонали
 * (W+A → upLeft). Противоположные гасят друг друга; ничего не зажато — null.
 */
export function directionFromKeys({ up, down, left, right }: HeldArrows): Direction | null {
  const dy = (down ? 1 : 0) - (up ? 1 : 0);
  const dx = (right ? 1 : 0) - (left ? 1 : 0);
  if (dy < 0) return dx < 0 ? 'upLeft' : dx > 0 ? 'upRight' : 'up';
  if (dy > 0) return dx < 0 ? 'downLeft' : dx > 0 ? 'downRight' : 'down';
  return dx < 0 ? 'left' : dx > 0 ? 'right' : null;
}
