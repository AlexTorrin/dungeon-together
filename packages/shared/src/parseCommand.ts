import type { Command } from './commands';
import { isDirection } from './direction';
import { ACTION_POINTS } from './config/turn';
import type { Action, Plan, Position } from './types';

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
  if (type === 'move') {
    const direction = field(raw, 'direction');
    return isDirection(direction) ? { type, direction } : null;
  }
  if (type === 'attack') {
    const target = parsePosition(field(raw, 'target'));
    return target ? { type, target } : null;
  }
  if (type === 'dropKey' || type === 'openDoor') return { type };
  if (type === 'dropCoins') {
    const amount = field(raw, 'amount');
    return isInteger(amount) && amount > 0 ? { type, amount } : null;
  }
  if (type === 'equip' || type === 'drop' || type === 'drink') {
    const itemId = field(raw, 'itemId');
    return isId(itemId) ? { type, itemId } : null;
  }
  return null;
}

/** Строковый id разумной длины. Есть ли такой предмет у игрока, решают правила. */
function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PLAYER_ID_LENGTH;
}

/** Клетка: целые x и y. Попадает ли она на карту, решают правила, а не парсер. */
function parsePosition(raw: unknown): Position | null {
  if (!isObject(raw)) return null;
  const x = field(raw, 'x');
  const y = field(raw, 'y');
  return isInteger(x) && isInteger(y) ? { x, y } : null;
}

const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);

/**
 * Разбирает план на ход: массив из 1..ACTION_POINTS действий. Укладывается ли он в ОД с учётом
 * цены действий и достают ли удары, решают правила (rules/plan.ts), а не парсер.
 */
export function parsePlan(raw: unknown): Plan | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ACTION_POINTS) return null;
  const plan: Action[] = [];
  for (const item of raw as readonly unknown[]) {
    const action = parseAction(item);
    if (!action) return null;
    plan.push(action);
  }
  return plan;
}

/**
 * Разбирает команду из недоверенных данных. Проверяет только форму: существует ли игрок
 * и может ли он сейчас ходить, решает applyCommand. Кто прислал команду — забота сервера:
 * playerId он должен подставлять сам, а не верить клиенту.
 */
export function parseCommand(raw: unknown): Command | null {
  if (!isObject(raw)) return null;
  const type = field(raw, 'type');
  const playerId = field(raw, 'playerId');
  if (typeof playerId !== 'string' || playerId.length === 0) return null;
  if (playerId.length > MAX_PLAYER_ID_LENGTH) return null;

  if (type === 'cancelPlan') return { type, playerId };
  if (type !== 'submitPlan') return null;
  const plan = parsePlan(field(raw, 'plan'));
  return plan ? { type, playerId, plan } : null;
}
