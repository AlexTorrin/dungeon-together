import { randomInt } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import {
  MAX_PLAYERS,
  applyCommand,
  createGameState,
  generateLevel,
  parseCommand,
  parseCreateOptions,
  finishRun,
  parseJoinOptions,
  startRun,
  type CreateOptions,
  type Difficulty,
  type Room as RoomLayout,
  type GameState,
  type JoinOptions,
  type PlayerId,
  type ServerMessages,
} from '@dt/shared';
import { freePlayerId } from './lobby';
import type { ProfileStore } from './ProfileStore';
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
 *
 * Профили: при старте снаряжение забирается из профиля (startRun), вынесенное возвращается
 * в профиль сразу, как игрок вышел дверью или уровень пройден (finishRun). Клиенту не верим.
 */
export abstract class DungeonRoom extends Room {
  /** Откуда брать снаряжение и куда возвращать добычу; задаёт createServer. */
  protected abstract readonly profiles: ProfileStore;
  override maxClients = MAX_PLAYERS;
  private options: CreateOptions = parseCreateOptions(undefined);
  /** sessionId → место игрока. Порядок вставки — порядок входа (первый — хост). */
  private readonly seats = new Map<string, Seat>();
  private game: GameState | null = null;
  /** Токены участников забега (playerId → токен): ушедший из комнаты тоже мог вынести добычу. */
  private readonly runTokens = new Map<PlayerId, string>();
  /** Чья добыча уже возвращена в профиль. */
  private readonly settled = new Set<PlayerId>();

  override async onCreate(raw: unknown): Promise<void> {
    this.options = parseCreateOptions(raw);
    this.roomId = await uniqueRoomCode();
    this.onMessage('start', (client) => this.start(client));
    this.onMessage('command', (client, message: unknown) => this.command(client, message));
  }

  override onJoin(client: Client, raw: unknown): void {
    const playerId = freePlayerId([...this.seats.values()].map((s) => s.playerId));
    if (!playerId || this.game) throw new Error('Комната заполнена или игра уже идёт');
    const options = parseJoinOptions(raw);
    if (!options) throw new Error('Нужен токен игрока');
    if ([...this.seats.values()].some((s) => s.token === options.token)) {
      throw new Error('Вы уже в этой комнате');
    }
    this.seats.set(client.sessionId, { playerId, ...options });
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
    // Снаряжение уходит из профиля сейчас: погиб или ушёл — его больше нет.
    const loadouts = Object.fromEntries(
      seats.map(({ playerId, token }) => {
        const { profile, loadout } = startRun(this.profiles.get(token));
        void this.profiles.set(token, profile);
        this.runTokens.set(playerId, token);
        return [playerId, loadout];
      }),
    );
    this.game = createGameState(
      this.level(seed, difficulty),
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
    this.settleEscaped(state);
    if (events.length > 0) this.broadcastTyped('events', { events, state });
  }

  /** Уровень забега; тесты подменяют его маленькой комнатой. */
  protected level(seed: number, difficulty: Difficulty): RoomLayout {
    return generateLevel(seed, difficulty);
  }

  /** Вышедшим дверью (и всем живым при победе) — вынесенное в профиль, ровно один раз. */
  private settleEscaped(state: GameState): void {
    for (const [playerId, carried] of Object.entries(state.escaped)) {
      const token = this.runTokens.get(playerId);
      if (!token || this.settled.has(playerId)) continue;
      this.settled.add(playerId);
      void this.profiles.set(token, finishRun(this.profiles.get(token), carried));
    }
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
