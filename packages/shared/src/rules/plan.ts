import { ACTION_POINTS, actionCost } from '../config/turn';
import { step } from '../direction';
import { canStep } from '../map/pathfinding';
import { chebyshev } from '../map/geometry';
import type { Action, Actor, GameState, Item, Plan } from '../types';
import { canAttack } from './combat';

const WAIT: Action = { type: 'wait' };

/** Что из состояния нужно, чтобы проверить план: карта и дверь. */
export type World = Pick<GameState, 'map' | 'door'>;

/** Стоит ли актор рядом с закрытой дверью (в т.ч. по диагонали) и есть ли у него ключ. */
export function canOpenDoor(world: World, actor: Actor): boolean {
  const { door } = world;
  return !!door && !door.open && actor.keys > 0 && chebyshev(actor.pos, door.pos) === 1;
}

/** Как пройдёт план, если всё удастся (без учёта других акторов — их выбор неизвестен). */
export interface PlanSimulation {
  /** Действие в каждой из ACTION_POINTS фаз: замах и недостающие фазы — ожидание. */
  readonly phases: readonly Action[];
  /** Каким будет актор к началу каждой фазы: клетка, оружие в руках, рюкзак. */
  readonly before: readonly Actor[];
  /** В какой фазе срабатывает каждое действие плана (по порядку плана). */
  readonly phaseOf: readonly number[];
  /** Актор после всего плана. */
  readonly after: Actor;
  /** Сколько ОД занято. */
  readonly used: number;
}

/** Применяет к ожидаемому состоянию актора одно действие; null — действие невозможно. */
function applyExpected(world: World, actor: Actor, action: Action): Actor | null {
  const { map } = world;
  switch (action.type) {
    case 'move':
      return canStep(map, actor.pos, action.direction)
        ? { ...actor, pos: step(actor.pos, action.direction) }
        : actor; // упрётся — останется на месте, план от этого не ломается
    case 'attack':
      return canAttack(map, actor, action.target) ? actor : null;
    case 'equip': {
      const item = actor.backpack.find((i) => i.id === action.itemId);
      if (!item) return null;
      return { ...actor, weapon: item, backpack: swapOut(actor.backpack, item, actor.weapon) };
    }
    case 'drop': {
      if (actor.weapon?.id === action.itemId) return { ...actor, weapon: null };
      if (!actor.backpack.some((i) => i.id === action.itemId)) return null;
      return { ...actor, backpack: actor.backpack.filter((i) => i.id !== action.itemId) };
    }
    case 'dropCoins':
      return Number.isInteger(action.amount) && action.amount > 0 && action.amount <= actor.coins
        ? { ...actor, coins: actor.coins - action.amount }
        : null;
    case 'dropKey':
      return actor.keys > 0 ? { ...actor, keys: actor.keys - 1 } : null;
    case 'openDoor':
      return canOpenDoor(world, actor) ? { ...actor, keys: actor.keys - 1 } : null;
    case 'wait':
      return actor;
  }
}

/** Рюкзак после «взять item в руки»: item уходит, на его место — то, что было в руках. */
export function swapOut(backpack: readonly Item[], item: Item, hands: Item | null): Item[] {
  return backpack.flatMap((i) => (i.id !== item.id ? [i] : hands ? [hands] : []));
}

/**
 * Проигрывает план «в уме»: раскладывает по фазам (действие ценой больше 1 ОД занимает
 * несколько фаз и срабатывает в последней — раньше замах, актор стоит на месте) и следит,
 * где актор и что у него в руках. Цена удара — по оружию в руках в момент удара.
 * null — план дороже ОД, удар не достаёт или предмета для equip/drop нет.
 */
export function simulatePlan(world: World, actor: Actor, plan: Plan): PlanSimulation | null {
  const phases: Action[] = [];
  const before: Actor[] = [];
  const phaseOf: number[] = [];
  let current = actor;
  for (const action of plan) {
    const cost = actionCost(action, current.weapon);
    for (let i = 1; i < cost; i++) {
      phases.push(WAIT);
      before.push(current);
    }
    phaseOf.push(phases.length);
    phases.push(action);
    before.push(current);
    const next = applyExpected(world, current, action);
    if (!next) return null;
    current = next;
  }
  if (phases.length > ACTION_POINTS) return null;
  const used = phases.length;
  while (phases.length < ACTION_POINTS) {
    phases.push(WAIT);
    before.push(current);
  }
  return { phases, before, phaseOf, after: current, used };
}

/** Можно ли отправить план: не пустой, укладывается в ОД, все удары и предметы на месте. */
export function isPlanValid(world: World, actor: Actor, plan: Plan): boolean {
  return plan.length > 0 && simulatePlan(world, actor, plan) !== null;
}
