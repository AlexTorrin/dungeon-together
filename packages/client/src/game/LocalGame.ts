import { applyCommand, type Command, type GameEvent, type GameState } from '@dt/shared';
import type { GameSession } from './GameSession';

/** Одиночная игра: та же логика shared, только вызывается прямо в браузере. */
export class LocalGame implements GameSession {
  constructor(private current: GameState) {}

  get state(): GameState {
    return this.current;
  }

  dispatch(command: Command): readonly GameEvent[] {
    const { state, events } = applyCommand(this.current, command);
    this.current = state;
    return events;
  }
}
