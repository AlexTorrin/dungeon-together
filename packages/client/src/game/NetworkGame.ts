import type { Room } from '@colyseus/sdk';
import type { Command, GameState, PlayerId, ServerMessages } from '@dt/shared';
import { forgetRoom, rememberRoom } from '../net/resume';
import type { GameSession, SessionListener } from './GameSession';

/**
 * Сетевая игра: команды уходят на сервер, события и новое состояние приходят оттуда.
 * Для сцены ничем не отличается от LocalGame — в этом смысл интерфейса GameSession.
 * Создаётся в момент старта забега, чтобы не пропустить ни одного сообщения 'events'.
 *
 * Обрыв связи: SDK переподключается сам (а сервер держит наше место). Сообщения, пришедшие
 * за время обрыва, потеряны, поэтому после возврата просим resync и получаем состояние целиком.
 */
export class NetworkGame implements GameSession {
  private readonly listeners = new Set<SessionListener>();
  private current: GameState;
  /** Связь оборвалась окончательно (не вернулись вовремя) — мы больше не в игре. */
  onDisconnect: (() => void) | null = null;
  /** Связь пропала (false) или восстановилась (true) — пока пропала, ходить бесполезно. */
  onConnection: ((online: boolean) => void) | null = null;
  /** Пришло состояние целиком (после переподключения): пропущенное не проиграть — только встать. */
  onResync: ((state: GameState) => void) | null = null;
  /** Другой игрок потерял связь или вернулся. */
  onPlayerStatus: ((playerId: PlayerId, online: boolean) => void) | null = null;
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
    room.onMessage('sync', ({ state }: ServerMessages['sync']) => {
      this.current = state;
      this.onResync?.(state);
    });
    room.onMessage('playerStatus', ({ playerId, online }: ServerMessages['playerStatus']) =>
      this.onPlayerStatus?.(playerId, online),
    );
    room.onDrop(() => this.onConnection?.(false));
    room.onReconnect(() => {
      rememberRoom(room); // токен переподключения обновился
      room.send('resync', null);
      this.onConnection?.(true);
    });
    room.onLeave(() => {
      forgetRoom();
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

  /** Покинуть комнату по своей воле; сервер применит к нам команду leave. */
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    forgetRoom();
    // Связь уже могла пропасть — тогда и выходить неоткуда, ошибка нам не интересна.
    void this.room.leave().catch(() => undefined);
  }
}
