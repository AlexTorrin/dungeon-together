import type { ArmorType } from '../types';

export interface ArmorStats {
  /** На сколько уменьшается урон каждого удара по надевшему. */
  readonly defense: number;
}

export const ARMORS: Readonly<Record<ArmorType, ArmorStats>> = {
  leather: { defense: 1 },
  mail: { defense: 2 },
};

export const ARMOR_TYPES = Object.keys(ARMORS) as readonly ArmorType[];

/** Меньше этого броня урон не срезает: неуязвимых не бывает. */
export const MIN_DAMAGE = 1;

/** Урон удара amount по актору в броне armor (null — без брони). */
export function damageThrough(amount: number, armor: ArmorType | null): number {
  return armor ? Math.max(MIN_DAMAGE, amount - ARMORS[armor].defense) : amount;
}
