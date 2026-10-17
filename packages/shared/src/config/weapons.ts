import type { WeaponType } from '../types';

export interface WeaponStats {
  readonly damage: number;
  /**
   * Дальность удара по Чебышёву (с диагоналями): 1 — только соседние клетки,
   * 4 — любая клетка в квадрате 9×9 вокруг, если до неё есть прямая видимость.
   */
  readonly range: number;
}

/** Без оружия бьют кулаками. */
export const UNARMED: WeaponStats = { damage: 1, range: 1 };

export const WEAPONS: Readonly<Record<WeaponType, WeaponStats>> = {
  melee: { damage: 3, range: 1 },
  ranged: { damage: 2, range: 4 },
};

export const WEAPON_TYPES = Object.keys(WEAPONS) as readonly WeaponType[];
