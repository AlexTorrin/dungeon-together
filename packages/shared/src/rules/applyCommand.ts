import type { Command, GameEvent } from '../commands';
import type { GameState } from '../types';
import { submitAction } from './submitAction';

export interface CommandResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** Единая точка входа логики: Command → новое состояние + события. Чистая функция. */
export function applyCommand(state: GameState, command: Command): CommandResult {
  switch (command.type) {
    case 'submitAction':
      return submitAction(state, command);
  }
}
