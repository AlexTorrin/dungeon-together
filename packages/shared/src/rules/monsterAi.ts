import { AGGRO_RADIUS, AI_AIM_AT_CURRENT_CHANCE, ITEM_SEARCH_RADIUS } from '../config/ai';
import { DIRECTIONS, directionTo, step } from '../direction';
import { findPath, canStep } from '../map/pathfinding';
import { chance, nextInt, type RngState } from '../rng';
import type { Action, Actor, GameState, MonsterActor, Position } from '../types';
import { canAttack } from './combat';

interface Goal<T> {
  readonly target: T;
  readonly path: readonly Position[];
}

/** Ближайшая по пути цель не дальше maxSteps; при равенстве — первая по порядку. */
function nearest<T>(
  state: GameState,
  from: Position,
  candidates: readonly T[],
  posOf: (candidate: T) => Position,
  maxSteps: number,
): Goal<T> | null {
  let best: Goal<T> | null = null;
  for (const target of candidates) {
    const path = findPath(state.map, from, posOf(target), maxSteps);
    if (path && (!best || path.length < best.path.length)) best = { target, path };
  }
  return best;
}

/** Шаг к первой клетке пути. */
function stepAlong(from: Position, path: readonly Position[]): Action {
  const next = path[0];
  const direction = next ? directionTo(from, next) : null;
  return direction ? { type: 'move', direction } : { type: 'wait' };
}

/**
 * Куда бить игрока: с шансом AI_AIM_AT_CURRENT_CHANCE — туда, где он стоит, иначе —
 * в случайную соседнюю с ним клетку, куда он может шагнуть и куда бот достаёт.
 */
function aimAt(
  state: GameState,
  monster: MonsterActor,
  player: Actor,
  rng: RngState,
): readonly [Position, RngState] {
  const [atCurrent, afterChance] = chance(rng, AI_AIM_AT_CURRENT_CHANCE);
  if (atCurrent) return [player.pos, afterChance];
  const escapes = DIRECTIONS.filter((d) => canStep(state.map, player.pos, d))
    .map((d) => step(player.pos, d))
    .filter((cell) => canAttack(state.map, monster, cell));
  if (escapes.length === 0) return [player.pos, afterChance];
  const [i, afterPick] = nextInt(afterChance, 0, escapes.length - 1);
  return [escapes[i] ?? player.pos, afterPick];
}

/**
 * ИИ монстра. Видит только состояние на начало хода — выбор игроков в этом ходу ему
 * неизвестен, так что бот, как и игрок, угадывает. Правила для него те же, что для игроков.
 *
 * 1. Игрок в досягаемости удара → бьёт (туда, где тот стоит, или куда может отойти).
 * 2. Без оружия и предмет рядом → идёт за предметом.
 * 3. Игрок в радиусе агрессии → идёт к нему.
 * 4. Иначе ждёт.
 */
export function chooseMonsterAction(
  state: GameState,
  monster: MonsterActor,
  rng: RngState,
): readonly [Action, RngState] {
  const players = Object.values(state.actors).filter((a) => a.kind === 'player');

  const inReach = players.filter((p) => canAttack(state.map, monster, p.pos));
  const victim = nearest(state, monster.pos, inReach, (p) => p.pos, Number.POSITIVE_INFINITY);
  if (victim) {
    const [target, next] = aimAt(state, monster, victim.target, rng);
    return [{ type: 'attack', target }, next];
  }

  if (!monster.weapon) {
    const items = Object.values(state.items);
    const item = nearest(state, monster.pos, items, (i) => i.pos, ITEM_SEARCH_RADIUS);
    if (item) return [stepAlong(monster.pos, item.path), rng];
  }

  const prey = nearest(state, monster.pos, players, (p) => p.pos, AGGRO_RADIUS);
  if (prey) return [stepAlong(monster.pos, prey.path), rng];

  return [{ type: 'wait' }, rng];
}
