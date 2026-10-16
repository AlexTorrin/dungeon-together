import type { Command } from '../commands';
import type { GameState } from '../types';
import type { CommandResult } from './applyCommand';
import { resolveTurn } from './resolveTurn';

type SubmitActionCommand = Extract<Command, { type: 'submitAction' }>;

/** Игрок фиксирует действие на текущий ход. Повторный выбор в том же ходу игнорируется. */
export function submitAction(
  state: GameState,
  { playerId, action }: SubmitActionCommand,
): CommandResult {
  if (!state.players[playerId] || state.pendingActions[playerId]) return { state, events: [] };

  const next: GameState = {
    ...state,
    pendingActions: { ...state.pendingActions, [playerId]: action },
  };
  const submitted = { type: 'actionSubmitted', playerId, turn: state.turn } as const;

  const everyoneReady = Object.keys(next.players).every((id) => next.pendingActions[id]);
  if (!everyoneReady) return { state: next, events: [submitted] };

  const resolved = resolveTurn(next);
  return { state: resolved.state, events: [submitted, ...resolved.events] };
}
