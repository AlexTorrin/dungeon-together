import type { GameEvent } from '../commands';
import type { Action, Actor, ActorId, GameState } from '../types';
import type { CommandResult } from './applyCommand';
import { resolveMoves, type ActorIntent } from './resolveMoves';

/**
 * Действие актора в этот ход. Игроки — то, что выбрали; монстры пока стоят:
 * их ИИ (шаг 4) будет выбирать действие здесь же, поэтому игрокам никогда не нужно «ждать монстров».
 */
function actionOf(state: GameState, actor: Actor): Action {
  if (actor.kind === 'player') return state.pendingActions[actor.id] ?? { type: 'wait' };
  return { type: 'wait' };
}

/**
 * Разрешает ход, когда все игроки выбрали действия.
 * Атака пока ничего не делает (бой — шаг 4): актор стоит на месте, как при `wait`.
 */
export function resolveTurn(state: GameState): CommandResult {
  const actors = Object.values(state.actors);
  const intents: ActorIntent[] = actors.map((actor) => ({
    id: actor.id,
    from: actor.pos,
    action: actionOf(state, actor),
  }));
  const outcomes = resolveMoves(state.map, intents);

  const events: GameEvent[] = [];
  const nextActors: Record<ActorId, Actor> = {};
  for (const { id, from, action } of intents) {
    const actor = state.actors[id];
    const outcome = outcomes.get(id);
    if (!actor || !outcome) throw new Error(`Actor ${id} lost during turn resolution`);

    if (outcome.kind === 'moved' && action.type === 'move') {
      nextActors[id] = { ...actor, pos: outcome.to };
      events.push({
        type: 'moved',
        actorId: id,
        from,
        to: outcome.to,
        direction: action.direction,
      });
    } else if (outcome.kind === 'bumped' && action.type === 'move') {
      nextActors[id] = actor;
      events.push({
        type: 'bumped',
        actorId: id,
        at: outcome.at,
        direction: action.direction,
        reason: outcome.reason,
      });
    } else {
      nextActors[id] = actor;
      events.push({ type: 'waited', actorId: id });
    }
  }
  events.push({ type: 'turnResolved', turn: state.turn });

  return {
    state: { ...state, actors: nextActors, pendingActions: {}, turn: state.turn + 1 },
    events,
  };
}
