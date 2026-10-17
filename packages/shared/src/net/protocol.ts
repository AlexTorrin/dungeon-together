import type { Command, GameEvent } from '../commands';
import { BACKPACK_SIZE } from '../config/inventory';
import { DIFFICULTIES, type Difficulty } from '../config/level';
import { WEAPONS } from '../config/weapons';
import type { Loadout } from '../hub/profile';
import type { GameState, PlayerId, WeaponType } from '../types';

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

/** Опции при создании комнаты (хост). */
export interface CreateOptions {
  readonly difficulty: Difficulty;
}

/** Опции при входе в комнату (каждый игрок). */
export interface JoinOptions {
  readonly name: string;
  /** С чем игрок идёт в забег — пока из профиля в браузере (шаг 9b перенесёт профиль на сервер). */
  readonly loadout: Loadout;
}

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

const isWeaponType = (value: unknown): value is WeaponType =>
  typeof value === 'string' && Object.hasOwn(WEAPONS, value);

export function parseCreateOptions(raw: unknown): CreateOptions {
  const difficulty = isObject(raw) ? field(raw, 'difficulty') : undefined;
  return {
    difficulty:
      typeof difficulty === 'string' && Object.hasOwn(DIFFICULTIES, difficulty)
        ? (difficulty as Difficulty)
        : 'medium',
  };
}

/** Снаряжение: оружие в руках (или null) и рюкзак не больше BACKPACK_SIZE. Не подходит — пусто. */
export function parseLoadout(raw: unknown): Loadout {
  const empty: Loadout = { weapon: null, backpack: [] };
  if (!isObject(raw)) return empty;
  const weapon = field(raw, 'weapon');
  const backpack = field(raw, 'backpack');
  if (weapon !== null && !isWeaponType(weapon)) return empty;
  if (!Array.isArray(backpack) || backpack.length > BACKPACK_SIZE) return empty;
  if (!(backpack as readonly unknown[]).every(isWeaponType)) return empty;
  return { weapon, backpack: [...(backpack as WeaponType[])] };
}

/** Имя: обрезаем пробелы и длину; пустое — «Игрок». */
export function parseName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return name.slice(0, MAX_NAME_LENGTH) || 'Игрок';
}

export function parseJoinOptions(raw: unknown): JoinOptions {
  if (!isObject(raw)) return { name: parseName(undefined), loadout: parseLoadout(undefined) };
  return { name: parseName(field(raw, 'name')), loadout: parseLoadout(field(raw, 'loadout')) };
}

/** Код комнаты из ввода игрока: регистр и пробелы не важны. null — не похоже на код. */
export function parseRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return [...code].every((c) => ROOM_CODE_ALPHABET.includes(c)) ? code : null;
}
