import type { GameEvent } from '../commands';
import { ACTION_POINTS } from '../config/turn';
import { withExplored } from '../map/fov';
import { samePos } from '../map/geometry';
import type {
  Action,
  Actor,
  ActorId,
  GameMap,
  GameState,
  GameStatus,
  GroundItem,
  ItemId,
  Plan,
  Position,
} from '../types';
import type { CommandResult } from './applyCommand';
import { canAttack, weaponOf } from './combat';
import { chooseMonsterPlan } from './monsterAi';
import { planPhases } from './plan';
import { resolveMoves, type ActorIntent } from './resolveMoves';

/** Изменяемый «черновик» состояния на время разрешения хода; в состояние уходят обычные объекты. */
interface Turn {
  readonly map: GameMap;
  readonly actors: Map<ActorId, Actor>;
  readonly items: Map<ItemId, GroundItem>;
  readonly events: GameEvent[];
}

/**
 * Разрешает ход, когда все игроки выбрали планы.
 *
 * 1. Планы: игроки — что выбрали; монстры — ИИ (по состоянию на начало хода).
 * 2. Фазы по очереди (ACTION_POINTS штук, resolvePhase): в каждой все действуют одновременно.
 *    Убитый в фазе 1 во второй уже не действует. После каждой фазы — событие phaseResolved.
 * 3. Конец игры: игроков не осталось — поражение; убит последний монстр — победа.
 * 4. Память команды (explored) пополняется тем, что игроки видят с новых позиций.
 */
export function resolveTurn(state: GameState): CommandResult {
  // 1. Планы, разложенные по фазам
  let rng = state.rng;
  const phases = new Map<ActorId, Action[]>();
  for (const actor of Object.values(state.actors)) {
    let plan: Plan;
    if (actor.kind === 'player') plan = state.pendingPlans[actor.id] ?? [];
    else [plan, rng] = chooseMonsterPlan(state, actor, rng);
    phases.set(actor.id, planPhases(plan) ?? []);
  }

  // 2. Фазы
  const turn: Turn = {
    map: state.map,
    actors: new Map(Object.entries(state.actors)),
    items: new Map(Object.entries(state.items)),
    events: [],
  };
  for (let phase = 0; phase < ACTION_POINTS; phase++) {
    const actions = new Map<ActorId, Action>();
    for (const id of turn.actors.keys())
      actions.set(id, phases.get(id)?.[phase] ?? { type: 'wait' });
    resolvePhase(turn, actions);
    turn.events.push({ type: 'phaseResolved', phase: phase + 1 });
    if (![...turn.actors.values()].some((a) => a.kind === 'player')) break;
  }

  // 3. Конец игры
  const status = nextStatus(state, [...turn.actors.values()]);
  turn.events.push({ type: 'turnResolved', turn: state.turn });
  if (status !== 'playing') turn.events.push({ type: 'gameOver', status });

  // 4. Память команды
  const next: GameState = {
    ...state,
    actors: Object.fromEntries(turn.actors),
    items: Object.fromEntries(turn.items),
    rng,
    status,
    pendingPlans: {},
    turn: state.turn + 1,
  };
  return { state: { ...next, explored: withExplored(next) }, events: turn.events };
}

/**
 * Одна фаза: все действуют одновременно.
 *
 * 1. Шаги — с конфликтами (resolveMoves).
 * 2. Подбор: кто шагнул на предмет, берёт его, а своё оружие кладёт на эту клетку.
 * 3. Удары — по клеткам, где акторы стоят ПОСЛЕ шагов этой фазы. Отошёл — увернулся, шагнул под
 *    удар — получил. Удар, который с фактической позиции уже не достаёт (упёрся в стену, цель за
 *    углом), срывается и считается ожиданием. Урон применяется разом: убитый тоже успевает ударить.
 * 4. Смерти: hp ≤ 0 — актор удаляется, его оружие падает на пол.
 */
function resolvePhase(turn: Turn, actions: ReadonlyMap<ActorId, Action>): void {
  const { actors, items, events } = turn;
  const intents: ActorIntent[] = [...actors.values()].map((actor) => ({
    id: actor.id,
    from: actor.pos,
    action: actions.get(actor.id) ?? { type: 'wait' },
  }));

  // 1. Шаги
  const outcomes = resolveMoves(turn.map, intents);
  const moved = new Set<ActorId>();
  const attacks: { readonly id: ActorId; readonly target: Position }[] = [];
  for (const { id, from, action } of intents) {
    const actor = actors.get(id);
    const outcome = outcomes.get(id);
    if (!actor || !outcome) throw new Error(`Actor ${id} lost during turn resolution`);

    if (action.type === 'move' && outcome.kind === 'moved') {
      actors.set(id, { ...actor, pos: outcome.to });
      moved.add(id);
      events.push({
        type: 'moved',
        actorId: id,
        from,
        to: outcome.to,
        direction: action.direction,
      });
    } else if (action.type === 'move' && outcome.kind === 'bumped') {
      events.push({
        type: 'bumped',
        actorId: id,
        at: outcome.at,
        direction: action.direction,
        reason: outcome.reason,
      });
    } else if (action.type === 'attack' && canAttack(turn.map, actor, action.target)) {
      attacks.push({ id, target: action.target });
      events.push({ type: 'attacked', actorId: id, target: action.target });
    } else {
      events.push({ type: 'waited', actorId: id });
    }
  }

  // 2. Подбор
  for (const id of moved) {
    const actor = actors.get(id);
    const found = actor && [...items.values()].find((item) => samePos(item.pos, actor.pos));
    if (!actor || !found) continue;
    items.delete(found.id);
    if (actor.weapon) {
      items.set(actor.weapon.id, { ...actor.weapon, pos: actor.pos });
      events.push({ type: 'itemDropped', itemId: actor.weapon.id, at: actor.pos });
    }
    actors.set(id, { ...actor, weapon: { id: found.id, type: found.type } });
    events.push({ type: 'itemPickedUp', actorId: id, itemId: found.id });
  }

  // 3. Удары: урон по позициям после шагов, применяется разом
  const damage = new Map<ActorId, number>();
  for (const { id, target } of attacks) {
    const attacker = actors.get(id);
    if (!attacker) continue;
    const { damage: amount } = weaponOf(attacker);
    for (const victim of actors.values()) {
      if (!samePos(victim.pos, target)) continue;
      const hp = victim.hp - (damage.get(victim.id) ?? 0) - amount;
      damage.set(victim.id, (damage.get(victim.id) ?? 0) + amount);
      events.push({ type: 'damaged', actorId: victim.id, by: id, amount, hp });
    }
  }
  for (const [id, amount] of damage) {
    const actor = actors.get(id);
    if (actor) actors.set(id, { ...actor, hp: actor.hp - amount });
  }

  // 4. Смерти
  for (const actor of [...actors.values()]) {
    if (actor.hp > 0) continue;
    actors.delete(actor.id);
    events.push({ type: 'died', actorId: actor.id, at: actor.pos });
    if (actor.weapon) {
      items.set(actor.weapon.id, { ...actor.weapon, pos: actor.pos });
      events.push({ type: 'itemDropped', itemId: actor.weapon.id, at: actor.pos });
    }
  }
}

function nextStatus(before: GameState, after: readonly Actor[]): GameStatus {
  const count = (actors: readonly Actor[], kind: Actor['kind']): number =>
    actors.filter((a) => a.kind === kind).length;
  if (count(after, 'player') === 0) return 'lost';
  // Победа — только когда убит последний монстр: комната без монстров не выигрывается сама.
  const monstersBefore = count(Object.values(before.actors), 'monster');
  if (monstersBefore > 0 && count(after, 'monster') === 0) return 'won';
  return 'playing';
}
