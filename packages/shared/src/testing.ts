/** Хелперы для тестов: явно собранное состояние. В игре не используются. */
import { MONSTERS, PLAYER_MAX_HP } from './config/actors';
import { parseRoom } from './map/room';
import { createGameState } from './state/createGameState';
import type {
  Actor,
  GameState,
  GroundItem,
  PotionItem,
  MonsterActor,
  MonsterSpecies,
  PlayerActor,
  WeaponItem,
  WeaponType,
} from './types';

export const TEST_SEED = 42;

export const weapon = (id: string, type: WeaponType): WeaponItem => ({ id, type });
export const potion = (id: string): PotionItem => ({ id, type: 'potion' });

export function playerAt(
  id: string,
  x: number,
  y: number,
  extra: Partial<PlayerActor> = {},
): PlayerActor {
  return {
    kind: 'player',
    id,
    pos: { x, y },
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    weapon: null,
    backpack: [],
    coins: 0,
    keys: 0,
    ...extra,
  };
}

export function monsterAt(
  id: string,
  species: MonsterSpecies,
  x: number,
  y: number,
  extra: Partial<MonsterActor> = {},
): MonsterActor {
  const { maxHp } = MONSTERS[species];
  return {
    kind: 'monster',
    id,
    species,
    pos: { x, y },
    hp: maxHp,
    maxHp,
    weapon: null,
    backpack: [],
    coins: 0,
    keys: 0,
    ...extra,
  };
}

/** Состояние из ASCII-карты (с '@') и явного списка акторов и предметов на полу. */
export function makeState(
  ascii: string,
  actors: readonly Actor[],
  items: readonly GroundItem[] = [],
  seed = TEST_SEED,
): GameState {
  const base = createGameState(parseRoom(ascii), [], seed);
  return {
    ...base,
    actors: Object.fromEntries(actors.map((a) => [a.id, a])),
    items: Object.fromEntries(items.map((i) => [i.id, i])),
  };
}
