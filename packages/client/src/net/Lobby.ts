import type { Room } from '@colyseus/sdk';
import type { GameState, ServerMessages } from '@dt/shared';
import { NetworkGame } from '../game/NetworkGame';

type LobbyInfo = ServerMessages['lobby'];

export interface StartedGame {
  readonly session: NetworkGame;
  readonly title: string;
  readonly state: GameState;
}

/**
 * Подключение к комнате, пока игра не началась. Живёт дольше сцены лобби (та перерисовывается
 * через restart), поэтому сообщения слушает здесь и хранит последнее известное.
 */
export class Lobby {
  info: LobbyInfo | null = null;
  started: StartedGame | null = null;
  /** Связь оборвалась до старта. */
  lost = false;
  /** Сцена подписывается, чтобы перерисоваться. */
  onChange: (() => void) | null = null;
  private leaving = false;

  constructor(readonly room: Room) {
    room.onMessage('lobby', (info: LobbyInfo) => {
      this.info = info;
      this.onChange?.();
    });
    room.onMessage('started', ({ state, title }: ServerMessages['started']) => {
      // Сессию создаём сразу: следующие сообщения 'events' уже её.
      this.started = { session: new NetworkGame(room, state), title, state };
      this.onChange?.();
    });
    room.onLeave(() => {
      if (this.leaving || this.started) return;
      this.lost = true;
      this.onChange?.();
    });
  }

  start(): void {
    this.room.send('start', null);
  }

  leave(): void {
    this.leaving = true;
    // Связь уже могла пропасть — тогда и выходить неоткуда.
    void this.room.leave().catch(() => undefined);
  }
}
