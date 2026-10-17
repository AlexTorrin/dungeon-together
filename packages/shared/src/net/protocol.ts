import type { Command, GameEvent } from '../commands';
import { DIFFICULTIES, type Difficulty } from '../config/level';
import { parseToken } from '../hub/actions';
import type { GameState, PlayerId } from '../types';

/**
 * Протокол между клиентом и сервером (Colyseus-комната `dungeon`). Только типы и разбор
 * недоверенных данных — никакого сетевого кода, поэтому живёт в shared.
 *
 * Состояние игры передаётся целиком, обычными объектами: для пошаговой игры это одно
 * сообщение на команду, и клиенту не нужно ничего собирать по кусочкам.
 */
export const ROOM_NAME = 'dungeon';
export const MAX_PLAYERS = 4;
export const MAX_NAME_LENGTH = 16;
/** Код комнаты: столько букв, без похожих друг на друга (O/0, I/1). */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/**
 * Сколько секунд сервер держит место отключившегося игрока. Пока ждёт — ход тоже ждёт его;
 * не вернулся — игрок покидает уровень (leave).
 */
export const RECONNECT_SECONDS = 30;

/** Опции при создании комнаты (хост). */
export interface CreateOptions {
  readonly difficulty: Difficulty;
}

/** Опции при входе в комнату (каждый игрок). */
export interface JoinOptions {
  readonly name: string;
  /** Токен игрока: по нему сервер находит профиль — снаряжение для забега и куда вернуть добычу. */
  readonly token: string;
}

/** HTTP-маршруты лагеря на том же сервере; токен — в заголовке `Authorization: Bearer …`. */
export const PROFILE_PATH = '/profile';
export const PROFILE_ACTION_PATH = '/profile/action';

export interface LobbyPlayer {
  readonly playerId: PlayerId;
  readonly name: string;
}

/** Сообщения клиент → сервер (тип сообщения → содержимое). */
export interface ClientMessages {
  /** Хост начинает забег. */
  readonly start: null;
  /** Команда игре; playerId сервер подставит сам. */
  readonly command: DistributiveOmit<Command, 'playerId'>;
  /** После переподключения: пришлите всё заново (lobby и, если игра идёт, sync). */
  readonly resync: null;
}

/** Сообщения сервер → клиент. */
export interface ServerMessages {
  /** Кто в комнате; приходит при каждом изменении состава, пока игра не началась. */
  readonly lobby: {
    readonly code: string;
    readonly difficulty: Difficulty;
    readonly players: readonly LobbyPlayer[];
    readonly host: PlayerId;
    /** Кто вы — у каждого клиента своё. */
    readonly you: PlayerId;
  };
  /** Забег начался: начальное состояние. */
  readonly started: { readonly state: GameState; readonly title: string };
  /** Ответ на resync: текущее состояние целиком (пропущенные события не повторяются). */
  readonly sync: { readonly state: GameState; readonly title: string };
  /** Игрок потерял связь (сервер ждёт его RECONNECT_SECONDS) или вернулся. */
  readonly playerStatus: { readonly playerId: PlayerId; readonly online: boolean };
  /** Результат чьей-то команды: события и состояние, к которому они привели. */
  readonly events: { readonly events: readonly GameEvent[]; readonly state: GameState };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// ---------- Разбор недоверенных данных ----------

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (obj: Fields, name: string): unknown =>
  Object.hasOwn(obj, name) ? obj[name] : undefined;

export function parseCreateOptions(raw: unknown): CreateOptions {
  const difficulty = isObject(raw) ? field(raw, 'difficulty') : undefined;
  return {
    difficulty:
      typeof difficulty === 'string' && Object.hasOwn(DIFFICULTIES, difficulty)
        ? (difficulty as Difficulty)
        : 'medium',
  };
}

/** Имя: обрезаем пробелы и длину; пустое — «Игрок». */
export function parseName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return name.slice(0, MAX_NAME_LENGTH) || 'Игрок';
}

/** Опции входа; null — без годного токена (без него не найти профиль). */
export function parseJoinOptions(raw: unknown): JoinOptions | null {
  if (!isObject(raw)) return null;
  const token = parseToken(field(raw, 'token'));
  return token ? { name: parseName(field(raw, 'name')), token } : null;
}

/** Код комнаты из ввода игрока: регистр и пробелы не важны. null — не похоже на код. */
export function parseRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return [...code].every((c) => ROOM_CODE_ALPHABET.includes(c)) ? code : null;
}
