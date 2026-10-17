import type { Command, GameEvent } from '../commands';
import type { GameState } from '../types';
import { leave } from './leave';
import { cancelPlan, submitPlan } from './submitPlan';

export interface CommandResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** Единая точка входа логики: Command → новое состояние + события. Чистая функция. */
export function applyCommand(state: GameState, command: Command): CommandResult {
  switch (command.type) {
    case 'submitPlan':
      return submitPlan(state, command);
    case 'cancelPlan':
      return cancelPlan(state, command);
    case 'leave':
      return leave(state, command);
  }
}
