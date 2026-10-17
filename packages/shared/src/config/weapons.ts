import type { WeaponType } from '../types';

export interface WeaponStats {
  readonly damage: number;
  /** На сколько клеток по прямой достаёт удар/бросок. 1 — только соседняя клетка. */
  readonly range: number;
}

/** Без оружия бьют кулаками. */
export const UNARMED: WeaponStats = { damage: 1, range: 1 };

export const WEAPONS: Readonly<Record<WeaponType, WeaponStats>> = {
  bone: { damage: 3, range: 1 },
  darts: { damage: 2, range: 5 },
  fireFlask: { damage: 4, range: 3 },
  bigFlask: { damage: 6, range: 2 },
};

export const WEAPON_TYPES = Object.keys(WEAPONS) as readonly WeaponType[];
