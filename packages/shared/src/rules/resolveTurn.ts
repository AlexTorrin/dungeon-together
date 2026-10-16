import type { GameEvent } from '../commands';
import type { Action, GameState, Player, PlayerId } from '../types';
import type { CommandResult } from './applyCommand';
import { resolveMoves, type ActorIntent } from './resolveMoves';

/**
 * Разрешает ход, когда все игроки выбрали действия.
 * Когда появятся монстры (шаг 4), их ИИ будет выбирать действия здесь же — перед resolveMoves,
 * поэтому игрокам никогда не нужно «ждать монстров».
 */
export function resolveTurn(state: GameState): CommandResult {
  const players = Object.values(state.players);
  const intents: ActorIntent[] = players.map((player) => ({
    id: player.id,
    from: player.pos,
    action: state.pendingActions[player.id] ?? { type: 'wait' },
  }));
  const outcomes = resolveMoves(state.map, intents);

  const events: GameEvent[] = [];
  const nextPlayers: Record<PlayerId, Player> = {};
  for (const player of players) {
    const outcome = outcomes.get(player.id) ?? { kind: 'waited' };
    const action: Action = state.pendingActions[player.id] ?? { type: 'wait' };
    const direction = action.type === 'move' ? action.direction : null;

    if (outcome.kind === 'moved' && direction) {
      nextPlayers[player.id] = { ...player, pos: outcome.to };
      events.push({
        type: 'moved',
        actorId: player.id,
        from: player.pos,
        to: outcome.to,
        direction,
      });
    } else {
      nextPlayers[player.id] = player;
      if (outcome.kind === 'bumped' && direction) {
        events.push({
          type: 'bumped',
          actorId: player.id,
          at: outcome.at,
          direction,
          reason: outcome.reason,
        });
      } else {
        events.push({ type: 'waited', actorId: player.id });
      }
    }
  }
  events.push({ type: 'turnResolved', turn: state.turn });

  return {
    state: { ...state, players: nextPlayers, pendingActions: {}, turn: state.turn + 1 },
    events,
  };
}
