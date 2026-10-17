import type { Command } from '../commands';
import type { GameState, PlayerActor, PlayerId } from '../types';
import type { CommandResult } from './applyCommand';
import { canAttack } from './combat';
import { resolveTurn } from './resolveTurn';

type SubmitActionCommand = Extract<Command, { type: 'submitAction' }>;

/** Игрок с таким id. Object.hasOwn — чтобы id вроде 'constructor' не нашёл ничего в прототипе. */
function findPlayer(state: GameState, id: PlayerId): PlayerActor | undefined {
  if (!Object.hasOwn(state.actors, id)) return undefined;
  const actor = state.actors[id];
  return actor?.kind === 'player' ? actor : undefined;
}

/**
 * Игрок фиксирует действие на текущий ход. Игнорируется (без событий): повторный выбор
 * в том же ходу, неизвестный id или id монстра, команда после конца игры, удар по клетке,
 * до которой не достать (дальность оружия, стены, своя клетка).
 */
export function submitAction(
  state: GameState,
  { playerId, action }: SubmitActionCommand,
): CommandResult {
  const ignored = { state, events: [] };
  if (state.status !== 'playing') return ignored;
  const player = findPlayer(state, playerId);
  if (!player) return ignored;
  if (Object.hasOwn(state.pendingActions, playerId)) return ignored;
  if (action.type === 'attack' && !canAttack(state.map, player, action.target)) return ignored;

  const next: GameState = {
    ...state,
    pendingActions: { ...state.pendingActions, [playerId]: action },
  };
  const submitted = { type: 'actionSubmitted', playerId, turn: state.turn } as const;

  const everyoneReady = Object.values(next.actors)
    .filter((actor) => actor.kind === 'player')
    .every((player) => Object.hasOwn(next.pendingActions, player.id));
  if (!everyoneReady) return { state: next, events: [submitted] };

  const resolved = resolveTurn(next);
  return { state: resolved.state, events: [submitted, ...resolved.events] };
}
