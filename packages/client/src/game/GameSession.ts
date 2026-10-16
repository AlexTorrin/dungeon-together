import type { Command, GameEvent, GameState } from '@dt/shared';

/**
 * Абстракция «игры» для сцены. Сцена не знает, локальная это игра или сетевая:
 * она шлёт команды и проигрывает события. Сейчас есть только LocalGame;
 * на шаге 6 появится реализация поверх Colyseus с тем же интерфейсом.
 */
export interface GameSession {
  readonly state: GameState;
  dispatch(command: Command): readonly GameEvent[];
}
