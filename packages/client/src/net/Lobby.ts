import type { Room } from '@colyseus/sdk';
import type { GameState, ServerMessages } from '@dt/shared';
import { NetworkGame } from '../game/NetworkGame';
import { forgetRoom, rememberRoom } from './resume';

type LobbyInfo = ServerMessages['lobby'];

export interface StartedGame {
  readonly session: NetworkGame;
  readonly title: string;
  readonly state: GameState;
}

/**
 * Подключение к комнате, пока игра не началась. Живёт дольше сцены лобби (та перерисовывается
 * через restart), поэтому сообщения слушает здесь и хранит последнее известное.
 * Сразу просит resync: после перезагрузки страницы (reconnect) так узнаём, где мы — в лобби
 * или уже в игре; при обычном входе это просто ещё одно сообщение lobby.
 */
export class Lobby {
  info: LobbyInfo | null = null;
  started: StartedGame | null = null;
  /** Связь оборвалась окончательно до старта. */
  lost = false;
  /** Связь пропала, SDK переподключается. */
  reconnecting = false;
  /** Сцена подписывается, чтобы перерисоваться. */
  onChange: (() => void) | null = null;
  private leaving = false;

  constructor(readonly room: Room) {
    rememberRoom(room);
    room.onMessage('lobby', (info: LobbyInfo) => {
      this.info = info;
      this.onChange?.();
    });
    room.onMessage('started', ({ state, title }: ServerMessages['started']) =>
      this.begin(state, title),
    );
    // Вернулись в уже идущую игру.
    room.onMessage('sync', ({ state, title }: ServerMessages['sync']) => this.begin(state, title));
    room.onDrop(() => {
      if (this.started) return; // дальше связью занимается NetworkGame
      this.reconnecting = true;
      this.onChange?.();
    });
    room.onReconnect(() => {
      if (this.started) return;
      rememberRoom(room);
      this.reconnecting = false;
      room.send('resync', null);
      this.onChange?.();
    });
    room.onLeave(() => {
      if (this.leaving || this.started) return;
      forgetRoom();
      this.lost = true;
      this.onChange?.();
    });
    room.send('resync', null);
  }

  start(): void {
    this.room.send('start', null);
  }

  leave(): void {
    this.leaving = true;
    forgetRoom();
    // Связь уже могла пропасть — тогда и выходить неоткуда.
    void this.room.leave().catch(() => undefined);
  }

  private begin(state: GameState, title: string): void {
    if (this.started) return;
    // Сессию создаём сразу: следующие сообщения 'events' уже её.
    this.started = { session: new NetworkGame(this.room, state), title, state };
    this.onChange?.();
  }
}
