import type { Command, GameEvent } from '../commands';
import { allocateId } from '../state/ids';
import type { GameState, GroundItem, ItemId, Loot } from '../types';
import type { CommandResult } from './applyCommand';
import { findPlayer, resolveIfReady } from './submitPlan';

type LeaveCommand = Extract<Command, { type: 'leave' }>;

/**
 * Игрок покидает игру посреди уровня. Для него это как гибель: всё, что нёс, падает на его клетку
 * (союзники могут подобрать), с собой ничего не уносит. Без этого ушедший заблокировал бы ход —
 * его план ждали бы вечно. Если остальные уже отправили планы, ход тут же разрешается.
 * Ушёл последний игрок — уровень окончен: пройден, если кто-то раньше вышел дверью.
 */
export function leave(state: GameState, { playerId }: LeaveCommand): CommandResult {
  const player = findPlayer(state, playerId);
  if (state.status !== 'playing' || !player) return { state, events: [] };

  const at = player.pos;
  const events: GameEvent[] = [{ type: 'playerLeft', playerId, at }];
  const items: Record<ItemId, GroundItem> = { ...state.items };
  let nextId = state.nextId;
  for (const item of [...(player.weapon ? [player.weapon] : []), ...player.backpack]) {
    items[item.id] = { kind: 'weapon', ...item, pos: at };
    events.push({ type: 'itemDropped', actorId: playerId, itemId: item.id, at });
  }
  const dropNew = (loot: Loot): void => {
    let id: ItemId;
    [id, nextId] = allocateId(nextId, loot.kind);
    items[id] = { ...loot, id, pos: at };
    events.push({ type: 'itemDropped', actorId: playerId, itemId: id, at });
  };
  if (player.coins > 0) dropNew({ kind: 'coins', amount: player.coins });
  for (let k = 0; k < player.keys; k++) dropNew({ kind: 'key' });

  const actors = Object.fromEntries(Object.entries(state.actors).filter(([id]) => id !== playerId));
  const pendingPlans = Object.fromEntries(
    Object.entries(state.pendingPlans).filter(([id]) => id !== playerId),
  );
  const next: GameState = { ...state, actors, items, nextId, pendingPlans };

  if (!Object.values(actors).some((actor) => actor.kind === 'player')) {
    const status = Object.keys(state.escaped).length > 0 ? 'won' : 'lost';
    return { state: { ...next, status }, events: [...events, { type: 'gameOver', status }] };
  }
  return resolveIfReady(next, events);
}
