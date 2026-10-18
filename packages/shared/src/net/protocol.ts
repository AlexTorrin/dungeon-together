import type { Command, GameEvent } from '../commands';
import { DIFFICULTIES, type Difficulty } from '../config/level';
import { parseToken } from '../hub/actions';
import { isRoomPlayable, parseRoom } from '../map/room';
import type { GameState, PlayerId, Room } from '../types';

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

/** Своя комната из редактора не больше этого по каждой стороне. */
export const MAX_CUSTOM_ROOM_SIZE = 64;
export const MAX_ROOM_NAME_LENGTH = 24;

/**
 * Опции при создании комнаты (хост): подземелье выбранной сложности или своя комната из
 * редактора — в том же ASCII-формате, в каком она хранится в браузере.
 */
export type CreateOptions =
  | { readonly difficulty: Difficulty }
  | { readonly custom: { readonly name: string; readonly ascii: string } };

/**
 * Что за уровень в комнате (уже разобранные опции создания). Своя комната — тренировка:
 * без снаряжения из лагеря, и добыча в профиль не попадает.
 */
export type LevelChoice =
  | { readonly kind: 'dungeon'; readonly difficulty: Difficulty }
  | { readonly kind: 'custom'; readonly name: string; readonly room: Room };

/** Уровень для лобби: своя комната — только название, карту игроки увидят в игре. */
export type LobbyLevel =
  | { readonly kind: 'dungeon'; readonly difficulty: Difficulty }
  | { readonly kind: 'custom'; readonly name: string };

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
    readonly level: LobbyLevel;
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

/**
 * Опции создания: неизвестная сложность — средняя; своя комната, которая не разбирается или
 * в которую нельзя войти, — null (создавать нечего).
 */
export function parseCreateOptions(raw: unknown): LevelChoice | null {
  const custom = isObject(raw) ? field(raw, 'custom') : undefined;
  if (custom !== undefined) return parseCustomRoom(custom);
  const difficulty = isObject(raw) ? field(raw, 'difficulty') : undefined;
  return {
    kind: 'dungeon',
    difficulty:
      typeof difficulty === 'string' && Object.hasOwn(DIFFICULTIES, difficulty)
        ? (difficulty as Difficulty)
        : 'medium',
  };
}

function parseCustomRoom(raw: unknown): LevelChoice | null {
  if (!isObject(raw)) return null;
  const ascii = field(raw, 'ascii');
  // Каждая строка — не длиннее стороны плюс перевод строки: огромное до разбора не пускаем.
  const maxLength = (MAX_CUSTOM_ROOM_SIZE + 1) * MAX_CUSTOM_ROOM_SIZE;
  if (typeof ascii !== 'string' || ascii.length > maxLength) return null;
  let room: Room;
  try {
    room = parseRoom(ascii);
  } catch {
    return null;
  }
  const { width, height } = room.map;
  if (width > MAX_CUSTOM_ROOM_SIZE || height > MAX_CUSTOM_ROOM_SIZE) return null;
  if (!isRoomPlayable(room)) return null;
  return { kind: 'custom', name: parseRoomName(field(raw, 'name')), room };
}

/** Название своей комнаты: как имя игрока, пустое — «Своя комната». */
function parseRoomName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return name.slice(0, MAX_ROOM_NAME_LENGTH) || 'Своя комната';
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
