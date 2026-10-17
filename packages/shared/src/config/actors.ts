import type { MonsterSpecies } from '../types';

export const PLAYER_MAX_HP = 10;

export interface MonsterStats {
  readonly maxHp: number;
}

export const MONSTERS: Readonly<Record<MonsterSpecies, MonsterStats>> = {
  skeleton: { maxHp: 6 },
  skull: { maxHp: 3 },
  vampire: { maxHp: 10 },
};

export const MONSTER_SPECIES = Object.keys(MONSTERS) as readonly MonsterSpecies[];
