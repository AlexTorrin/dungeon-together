import { ACTION_POINTS, actionCost } from '../config/turn';
import { step } from '../direction';
import { canStep } from '../map/pathfinding';
import { chebyshev } from '../map/geometry';
import { potionHeal } from '../config/potion';
import { isArmor, isWeapon } from '../items';
import type { Action, Actor, GameState, Item, ItemId, Plan } from '../types';
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
    case 'equip':
      return equip(actor, action.itemId);
    case 'drop': {
      if (actor.weapon?.id === action.itemId) return { ...actor, weapon: null };
      if (actor.armor?.id === action.itemId) return { ...actor, armor: null };
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
    case 'drink': {
      const item = actor.backpack.find((i) => i.id === action.itemId);
      if (item?.type !== 'potion') return null;
      return { ...actor, ...drink(actor, item.id) };
    }
    case 'wait':
      return actor;
  }
}

/** Актор выпил баночку itemId: HP + половина максимума (не выше максимума), баночки нет. */
export function drink(actor: Actor, itemId: ItemId): Pick<Actor, 'hp' | 'backpack'> {
  return {
    hp: Math.min(actor.maxHp, actor.hp + potionHeal(actor.maxHp)),
    backpack: actor.backpack.filter((i) => i.id !== itemId),
  };
}

/**
 * Актор после «взять в руки» (оружие) или «надеть» (броню) предмет itemId из рюкзака;
 * null — такого нет или это баночка.
 */
export function equip<A extends Actor>(actor: A, itemId: ItemId): A | null {
  const item = actor.backpack.find((i) => i.id === itemId);
  if (item && isWeapon(item)) {
    return { ...actor, weapon: item, backpack: swapOut(actor.backpack, item, actor.weapon) };
  }
  if (item && isArmor(item)) {
    return { ...actor, armor: item, backpack: swapOut(actor.backpack, item, actor.armor) };
  }
  return null;
}

/** Рюкзак после «взять item в руки (надеть)»: item уходит, на его место — то, что было в руках (на себе). */
export function swapOut(backpack: readonly Item[], item: Item, worn: Item | null): Item[] {
  return backpack.flatMap((i) => (i.id !== item.id ? [i] : worn ? [worn] : []));
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
