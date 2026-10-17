import { applyCommand, type Command, type GameState } from '@dt/shared';
import type { GameSession, SessionListener } from './GameSession';

/**
 * Одиночная игра: та же логика shared, только вызывается прямо в браузере.
 * Ведёт себя как маленький сервер: команда применяется сразу (к authoritative-состоянию),
 * а события доставляются асинхронно, как пришли бы по сети. Поэтому сцена, которая
 * работает с LocalGame, без изменений заработает и с сетевой сессией.
 */
export class LocalGame implements GameSession {
  private readonly listeners = new Set<SessionListener>();
  /** Состояние «сервера»: к нему применяются команды, в порядке отправки. */
  private authoritative: GameState;
  /** То, что видит клиент: догоняет authoritative при доставке событий. */
  private published: GameState;

  constructor(initial: GameState) {
    this.authoritative = initial;
    this.published = initial;
  }

  get state(): GameState {
    return this.published;
  }

  send(command: Command): void {
    const { state, events } = applyCommand(this.authoritative, command);
    this.authoritative = state;
    if (events.length === 0) return;
    // Микрозадачи выполняются по порядку постановки, поэтому порядок событий сохраняется.
    queueMicrotask(() => {
      this.published = state;
      for (const listener of this.listeners) listener(events, state);
    });
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
