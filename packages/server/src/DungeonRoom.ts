import { randomInt } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import {
  MAX_PLAYERS,
  applyCommand,
  createGameState,
  generateLevel,
  parseCommand,
  parseCreateOptions,
  parseJoinOptions,
  type CreateOptions,
  type GameState,
  type JoinOptions,
  type PlayerId,
  type ServerMessages,
} from '@dt/shared';
import { freePlayerId } from './lobby';
import { uniqueRoomCode } from './roomCode';

interface Seat extends JoinOptions {
  readonly playerId: PlayerId;
}

const DIFFICULTY_TITLES = { easy: 'легко', medium: 'средне', hard: 'трудно' } as const;

/**
 * Комната — одна партия на 1–4 игроков. Сервер авторитетен: клиенты шлют только намерения,
 * а состояние меняет applyCommand из shared, здесь же, на сервере.
 *
 * Жизненный цикл: лобби (собираются игроки, хост жмёт «Начать») → игра → конец уровня.
 * После старта комната закрыта для новых игроков.
 */
export class DungeonRoom extends Room {
  override maxClients = MAX_PLAYERS;
  private options: CreateOptions = parseCreateOptions(undefined);
  /** sessionId → место игрока. Порядок вставки — порядок входа (первый — хост). */
  private readonly seats = new Map<string, Seat>();
  private game: GameState | null = null;

  override async onCreate(raw: unknown): Promise<void> {
    this.options = parseCreateOptions(raw);
    this.roomId = await uniqueRoomCode();
    this.onMessage('start', (client) => this.start(client));
    this.onMessage('command', (client, message: unknown) => this.command(client, message));
  }

  override onJoin(client: Client, raw: unknown): void {
    const playerId = freePlayerId([...this.seats.values()].map((s) => s.playerId));
    if (!playerId || this.game) throw new Error('Комната заполнена или игра уже идёт');
    this.seats.set(client.sessionId, { playerId, ...parseJoinOptions(raw) });
    this.sendLobby();
  }

  override onLeave(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    this.seats.delete(client.sessionId);
    if (!seat) return;
    if (this.game) this.apply({ type: 'leave', playerId: seat.playerId });
    else this.sendLobby();
  }

  private start(client: Client): void {
    if (this.game || this.hostSession() !== client.sessionId) return;
    const seed = randomInt(2 ** 32);
    const { difficulty } = this.options;
    const seats = [...this.seats.values()];
    const loadouts = Object.fromEntries(seats.map((s) => [s.playerId, s.loadout]));
    this.game = createGameState(
      generateLevel(seed, difficulty),
      seats.map((s) => s.playerId),
      seed,
      loadouts,
    );
    void this.lock();
    const title = `Подземелье #${seed} · ${DIFFICULTY_TITLES[difficulty]}`;
    this.broadcastTyped('started', { state: this.game, title });
  }

  /** Команда от клиента: разбираем как недоверенные данные, playerId — тот, кто прислал. */
  private command(client: Client, message: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat || !this.game || typeof message !== 'object' || message === null) return;
    const command = parseCommand({ ...message, playerId: seat.playerId });
    if (command) this.apply(command);
  }

  private apply(command: Parameters<typeof applyCommand>[1]): void {
    if (!this.game) return;
    const { state, events } = applyCommand(this.game, command);
    this.game = state;
    if (events.length > 0) this.broadcastTyped('events', { events, state });
  }

  private hostSession(): string | undefined {
    return this.seats.keys().next().value;
  }

  private sendLobby(): void {
    const host = this.seats.get(this.hostSession() ?? '')?.playerId ?? '';
    const players = [...this.seats.values()].map(({ playerId, name }) => ({ playerId, name }));
    for (const client of this.clients) {
      const you = this.seats.get(client.sessionId)?.playerId;
      if (!you) continue;
      const lobby: ServerMessages['lobby'] = {
        code: this.roomId,
        difficulty: this.options.difficulty,
        players,
        host,
        you,
      };
      client.send('lobby', lobby);
    }
  }

  /** Всем в комнате; тип сообщения и его содержимое сверяются с протоколом из shared. */
  private broadcastTyped<K extends keyof ServerMessages>(
    type: K,
    message: ServerMessages[K],
  ): void {
    this.broadcast(type, message);
  }
}
