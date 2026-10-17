import type { GameEvent } from '../commands';
import { withExplored } from '../map/fov';
import { samePos } from '../map/geometry';
import type { Action, Actor, ActorId, GameState, GameStatus, GroundItem, ItemId } from '../types';
import type { CommandResult } from './applyCommand';
import { weaponOf } from './combat';
import { chooseMonsterAction } from './monsterAi';
import { resolveMoves, type ActorIntent } from './resolveMoves';

/**
 * Разрешает ход, когда все игроки выбрали действия. Фазы (порядок важен):
 *
 * 1. Действия: игроки — то, что выбрали; монстры — решает ИИ (по состоянию на начало хода).
 * 2. Шаги — одновременно, с конфликтами (resolveMoves).
 * 3. Подбор: кто шагнул на предмет, берёт его, а своё оружие кладёт на эту клетку.
 * 4. Удары — по клеткам, где акторы стоят ПОСЛЕ шагов. Отошёл — увернулся,
 *    шагнул под удар — получил. Все удары одновременны: убитый в этот ход тоже успевает ударить.
 * 5. Смерти: hp ≤ 0 — актор удаляется, его оружие падает на пол.
 * 6. Конец игры: игроков не осталось — поражение; убит последний монстр — победа.
 * 7. Память команды (explored) пополняется тем, что игроки видят с новых позиций.
 */
export function resolveTurn(state: GameState): CommandResult {
  const events: GameEvent[] = [];

  // 1. Действия
  let rng = state.rng;
  const intents: ActorIntent[] = Object.values(state.actors).map((actor) => {
    let action: Action;
    if (actor.kind === 'player') {
      action = state.pendingActions[actor.id] ?? { type: 'wait' };
    } else {
      [action, rng] = chooseMonsterAction(state, actor, rng);
    }
    return { id: actor.id, from: actor.pos, action };
  });

  // 2. Шаги
  // Внутри — Map (удобно удалять), в состояние уходят обычные объекты.
  const actors = new Map<ActorId, Actor>();
  const outcomes = resolveMoves(state.map, intents);
  const moved = new Set<ActorId>();
  for (const { id, from, action } of intents) {
    const actor = state.actors[id];
    const outcome = outcomes.get(id);
    if (!actor || !outcome) throw new Error(`Actor ${id} lost during turn resolution`);
    actors.set(id, actor);

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
    } else if (action.type === 'attack') {
      events.push({ type: 'attacked', actorId: id, target: action.target });
    } else {
      events.push({ type: 'waited', actorId: id });
    }
  }

  // 3. Подбор
  const items = new Map<ItemId, GroundItem>(Object.entries(state.items));
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

  // 4. Удары: урон считается по позициям после шагов и применяется разом
  const damage = new Map<ActorId, number>();
  for (const { id, action } of intents) {
    const attacker = actors.get(id);
    if (action.type !== 'attack' || !attacker) continue;
    const { damage: amount } = weaponOf(attacker);
    for (const victim of actors.values()) {
      if (!samePos(victim.pos, action.target)) continue;
      const hp = victim.hp - (damage.get(victim.id) ?? 0) - amount;
      damage.set(victim.id, (damage.get(victim.id) ?? 0) + amount);
      events.push({ type: 'damaged', actorId: victim.id, by: id, amount, hp });
    }
  }
  for (const [id, amount] of damage) {
    const actor = actors.get(id);
    if (actor) actors.set(id, { ...actor, hp: actor.hp - amount });
  }

  // 5. Смерти
  for (const actor of [...actors.values()]) {
    if (actor.hp > 0) continue;
    actors.delete(actor.id);
    events.push({ type: 'died', actorId: actor.id, at: actor.pos });
    if (actor.weapon) {
      items.set(actor.weapon.id, { ...actor.weapon, pos: actor.pos });
      events.push({ type: 'itemDropped', itemId: actor.weapon.id, at: actor.pos });
    }
  }

  // 6. Конец игры
  const status = nextStatus(state, [...actors.values()]);
  events.push({ type: 'turnResolved', turn: state.turn });
  if (status !== 'playing') events.push({ type: 'gameOver', status });

  const next: GameState = {
    ...state,
    actors: Object.fromEntries(actors),
    items: Object.fromEntries(items),
    rng,
    status,
    pendingActions: {},
    turn: state.turn + 1,
  };
  return { state: { ...next, explored: withExplored(next) }, events };
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
