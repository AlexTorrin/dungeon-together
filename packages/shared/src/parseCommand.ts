import type { Command } from './commands';
import { isDirection } from './direction';
import type { Action } from './types';

/** Длиннее id не бывает: защита от мусора, а не правило игры. */
export const MAX_PLAYER_ID_LENGTH = 64;

type Fields = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Поле, только если оно своё, а не из прототипа. */
function field(obj: Fields, name: string): unknown {
  return Object.hasOwn(obj, name) ? obj[name] : undefined;
}

/**
 * Разбирает действие из недоверенных данных (сообщение по сети, JSON).
 * Возвращает новый объект только с известными полями или null, если данные не подходят.
 */
export function parseAction(raw: unknown): Action | null {
  if (!isObject(raw)) return null;
  const type = field(raw, 'type');
  if (type === 'wait') return { type: 'wait' };
  if (type !== 'move' && type !== 'attack') return null;

  const direction = field(raw, 'direction');
  return isDirection(direction) ? { type, direction } : null;
}

/**
 * Разбирает команду из недоверенных данных. Проверяет только форму: существует ли игрок
 * и может ли он сейчас ходить, решает applyCommand. Кто прислал команду — забота сервера:
 * playerId он должен подставлять сам, а не верить клиенту.
 */
export function parseCommand(raw: unknown): Command | null {
  if (!isObject(raw) || field(raw, 'type') !== 'submitAction') return null;

  const playerId = field(raw, 'playerId');
  if (typeof playerId !== 'string' || playerId.length === 0) return null;
  if (playerId.length > MAX_PLAYER_ID_LENGTH) return null;

  const action = parseAction(field(raw, 'action'));
  return action ? { type: 'submitAction', playerId, action } : null;
}
