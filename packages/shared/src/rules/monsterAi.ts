import { isWeapon } from '../items';
import { AGGRO_RADIUS, AI_AIM_AT_CURRENT_CHANCE, ITEM_SEARCH_RADIUS } from '../config/ai';
import { ACTION_POINTS, actionCost } from '../config/turn';
import { WEAPONS } from '../config/weapons';
import { VIEW_RADIUS } from '../config/vision';
import { DIRECTIONS, directionTo, step } from '../direction';
import { visibleFrom } from '../map/fov';
import { posKey } from '../map/geometry';
import { findPath, canStep } from '../map/pathfinding';
import { chance, nextInt, type RngState } from '../rng';
import type { Action, Actor, GameState, MonsterActor, Plan, Position } from '../types';
import { canAttack } from './combat';
import { swapOut } from './plan';

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
 * неизвестен, так что бот, как и игрок, угадывает. Правила для него те же, что для игроков:
 * замечает игроков и предметы, только если видит их (то же поле зрения, что у игроков),
 * удар стоит столько же ОД (меч — 2). apLeft — сколько ОД осталось в этом ходу.
 *
 * 1. Безоружный, а в рюкзаке есть оружие → берёт лучшее в руки.
 * 2. Игрок в досягаемости и на удар хватает ОД → бьёт (туда, где тот стоит, или куда может отойти).
 * 3. Безоружный с пустым рюкзаком и оружие рядом → идёт за ним.
 * 4. Игрок в радиусе агрессии → идёт к нему.
 * 5. Иначе ждёт.
 */
export function chooseMonsterAction(
  state: GameState,
  monster: MonsterActor,
  rng: RngState,
  apLeft: number = ACTION_POINTS,
): readonly [Action, RngState] {
  // Баночки монстры носят (и роняют при смерти), но не пьют — в руки берут только оружие.
  const weapons = monster.backpack.filter(isWeapon);
  if (!monster.weapon && weapons.length > 0) {
    const best = [...weapons].sort((a, b) => WEAPONS[b.type].damage - WEAPONS[a.type].damage)[0];
    if (best) return [{ type: 'equip', itemId: best.id }, rng];
  }

  const sees = visibleFrom(state.map, monster.pos, VIEW_RADIUS);
  const players = Object.values(state.actors).filter(
    (a) => a.kind === 'player' && sees.has(posKey(a.pos)),
  );

  const attackCost = actionCost({ type: 'attack', target: monster.pos }, monster.weapon);
  const inReach =
    attackCost <= apLeft ? players.filter((p) => canAttack(state.map, monster, p.pos)) : [];
  const victim = nearest(state, monster.pos, inReach, (p) => p.pos, Number.POSITIVE_INFINITY);
  if (victim) {
    const [target, next] = aimAt(state, monster, victim.target, rng);
    return [{ type: 'attack', target }, next];
  }
  // Игрок рядом, но на удар этим оружием ОД не хватает (замах мечом) — ждём следующего хода.
  if (players.some((p) => canAttack(state.map, monster, p.pos))) return [{ type: 'wait' }, rng];

  if (!monster.weapon && weapons.length === 0) {
    const items = Object.values(state.items).filter(
      (i) => i.kind === 'weapon' && sees.has(posKey(i.pos)),
    );
    const item = nearest(state, monster.pos, items, (i) => i.pos, ITEM_SEARCH_RADIUS);
    if (item) return [stepAlong(monster.pos, item.path), rng];
  }

  const prey = nearest(state, monster.pos, players, (p) => p.pos, AGGRO_RADIUS);
  if (prey) return [stepAlong(monster.pos, prey.path), rng];

  return [{ type: 'wait' }, rng];
}

/**
 * План монстра на ход: действия, пока хватает ОД. Следующее выбирается так, будто предыдущее
 * удалось (шагнул — уже на новой клетке, взял оружие — оно в руках); игроков бот считает
 * стоящими на месте — их выбор ему неизвестен, как и игрокам выбор бота.
 */
export function chooseMonsterPlan(
  state: GameState,
  monster: MonsterActor,
  rng: RngState,
): readonly [Plan, RngState] {
  const plan: Action[] = [];
  let self = monster;
  let next = rng;
  let apLeft = ACTION_POINTS;
  while (apLeft > 0) {
    const view: GameState = { ...state, actors: { ...state.actors, [self.id]: self } };
    let action: Action;
    [action, next] = chooseMonsterAction(view, self, next, apLeft);
    plan.push(action);
    apLeft -= actionCost(action, self.weapon);
    if (action.type === 'move' && canStep(state.map, self.pos, action.direction)) {
      self = { ...self, pos: step(self.pos, action.direction) };
    } else if (action.type === 'equip') {
      const item = self.backpack.find((i) => i.id === action.itemId);
      if (item && isWeapon(item))
        self = { ...self, weapon: item, backpack: swapOut(self.backpack, item, self.weapon) };
    }
  }
  return [plan, next];
}
