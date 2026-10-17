import type { WeaponType } from '../types';

export interface WeaponStats {
  readonly damage: number;
  /**
   * Дальность удара по Чебышёву (с диагоналями): 1 — только соседние клетки,
   * 4 — любая клетка в квадрате 9×9 вокруг, если атакующий её видит (map/fov.ts).
   */
  readonly range: number;
  /** Сколько очков действия стоит удар. Больше 1 — замах: удар срабатывает в последней фазе. */
  readonly cost: number;
}

/** Без оружия бьют кулаками. */
export const UNARMED: WeaponStats = { damage: 1, range: 1, cost: 1 };

export const WEAPONS: Readonly<Record<WeaponType, WeaponStats>> = {
  knife: { damage: 3, range: 1, cost: 1 },
  bow: { damage: 2, range: 4, cost: 1 },
  sword: { damage: 6, range: 1, cost: 2 },
  wand: { damage: 3, range: 6, cost: 1 },
};

export const WEAPON_TYPES = Object.keys(WEAPONS) as readonly WeaponType[];
