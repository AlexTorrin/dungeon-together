import type { Room } from '@colyseus/sdk';
import type { Command, GameState, ServerMessages } from '@dt/shared';
import type { GameSession, SessionListener } from './GameSession';

/**
 * Сетевая игра: команды уходят на сервер, события и новое состояние приходят оттуда.
 * Для сцены ничем не отличается от LocalGame — в этом смысл интерфейса GameSession.
 * Создаётся в момент старта забега, чтобы не пропустить ни одного сообщения 'events'.
 */
export class NetworkGame implements GameSession {
  private readonly listeners = new Set<SessionListener>();
  private current: GameState;
  /** Связь оборвалась не по нашей воле. */
  onDisconnect: (() => void) | null = null;
  private leaving = false;

  constructor(
    private readonly room: Room,
    initial: GameState,
  ) {
    this.current = initial;
    room.onMessage('events', ({ events, state }: ServerMessages['events']) => {
      this.current = state;
      for (const listener of this.listeners) listener(events, state);
    });
    room.onLeave(() => {
      if (!this.leaving) this.onDisconnect?.();
    });
  }

  get state(): GameState {
    return this.current;
  }

  /** playerId не отправляем: сервер знает, кто мы, и всё равно подставит свой. */
  send(command: Command): void {
    switch (command.type) {
      case 'submitPlan':
        this.room.send('command', { type: command.type, plan: command.plan });
        return;
      case 'cancelPlan':
        this.room.send('command', { type: command.type });
        return;
      case 'leave':
        this.leave();
        return;
    }
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Покинуть комнату; сервер применит к нам команду leave. */
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    // Связь уже могла пропасть — тогда и выходить неоткуда, ошибка нам не интересна.
    void this.room.leave().catch(() => undefined);
  }
}
