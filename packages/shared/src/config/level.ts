import type { MonsterSpecies, WeaponType } from '../types';

/** Параметры генерации уровня (generateLevel), общие для всех сложностей. */
export const LEVEL = {
  width: 40,
  height: 28,
  /** Комнаты генератора Digger: ширина и высота пола, [мин, макс]. */
  roomWidth: [4, 9],
  roomHeight: [3, 7],
  corridorLength: [2, 6],
  /** Какую долю карты прокопать, прежде чем остановиться. */
  dugPercentage: 0.3,
  /** Оружия на полу. */
  items: 3,
} as const;

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultyConfig {
  readonly monsters: number;
  /** Каких монстров ставить (по кругу случайно). */
  readonly species: readonly MonsterSpecies[];
  /** Сколько монстров вооружено и чем (оружие выпадает при смерти). */
  readonly armed: number;
  readonly armedWith: readonly WeaponType[];
  /** Монет на уровне всего [мин, макс]: часть лежит кучками по 1, часть у монстров. */
  readonly coins: readonly [number, number];
}

/** Сложности (docs/game-design.md): в среднем уровень даёт 2–3 монеты. */
export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyConfig>> = {
  easy: { monsters: 3, species: ['skull'], armed: 0, armedWith: [], coins: [2, 2] },
  medium: {
    monsters: 5,
    species: ['skull', 'skeleton'],
    armed: 1,
    armedWith: ['knife', 'bow'],
    coins: [2, 3],
  },
  hard: {
    monsters: 7,
    species: ['skeleton', 'vampire'],
    armed: 3,
    armedWith: ['knife', 'bow', 'sword', 'wand'],
    coins: [3, 3],
  },
};

export const DIFFICULTY_LIST: readonly Difficulty[] = ['easy', 'medium', 'hard'];
