import { BACKPACK_SIZE } from '../config/inventory';
import { WEAPONS } from '../config/weapons';
import type { WeaponType } from '../types';
import { buy, move, sell, type Profile, type Slot } from './profile';

/** Действие в лагере. Клиент шлёт его серверу, сервер применяет к профилю (applyHubAction). */
export type HubAction =
  | { readonly type: 'buy'; readonly weapon: WeaponType }
  | { readonly type: 'sell'; readonly slot: Slot }
  | { readonly type: 'move'; readonly from: Slot; readonly to: Slot['place'] };

/** Новый профиль или null — нельзя (нет монет, пусто, некуда положить). */
export function applyHubAction(profile: Profile, action: HubAction): Profile | null {
  switch (action.type) {
    case 'buy':
      return buy(profile, action.weapon);
    case 'sell':
      return sell(profile, action.slot);
    case 'move':
      return move(profile, action.from, action.to);
  }
}

// ---------- Разбор недоверенных данных (запросы клиента, файл профилей) ----------

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (obj: Fields, name: string): unknown =>
  Object.hasOwn(obj, name) ? obj[name] : undefined;

export const isWeaponType = (value: unknown): value is WeaponType =>
  typeof value === 'string' && Object.hasOwn(WEAPONS, value);

const isIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isPlace = (value: unknown): value is Slot['place'] =>
  value === 'hands' || value === 'backpack' || value === 'chest';

export function parseSlot(raw: unknown): Slot | null {
  if (!isObject(raw)) return null;
  const place = field(raw, 'place');
  if (place === 'hands') return { place };
  const index = field(raw, 'index');
  if ((place === 'backpack' || place === 'chest') && isIndex(index)) return { place, index };
  return null;
}

export function parseHubAction(raw: unknown): HubAction | null {
  if (!isObject(raw)) return null;
  const type = field(raw, 'type');
  if (type === 'buy') {
    const weapon = field(raw, 'weapon');
    return isWeaponType(weapon) ? { type, weapon } : null;
  }
  if (type === 'sell') {
    const slot = parseSlot(field(raw, 'slot'));
    return slot ? { type, slot } : null;
  }
  if (type === 'move') {
    const from = parseSlot(field(raw, 'from'));
    const to = field(raw, 'to');
    return from && isPlace(to) ? { type, from, to } : null;
  }
  return null;
}

/** Профиль из недоверенных данных; null — не похоже на профиль. */
export function parseProfile(raw: unknown): Profile | null {
  if (!isObject(raw)) return null;
  const coins = field(raw, 'coins');
  const hands = field(raw, 'hands');
  const backpack = field(raw, 'backpack');
  const chest = field(raw, 'chest');
  if (!isIndex(coins)) return null;
  if (hands !== null && !isWeaponType(hands)) return null;
  if (!Array.isArray(backpack) || backpack.length > BACKPACK_SIZE) return null;
  if (!Array.isArray(chest)) return null;
  const items = (list: readonly unknown[]): WeaponType[] | null =>
    list.every(isWeaponType) ? [...list] : null;
  const backpackItems = items(backpack);
  const chestItems = items(chest);
  if (!backpackItems || !chestItems) return null;
  return { coins, hands, backpack: backpackItems, chest: chestItems };
}

/** Токен игрока: 16–128 символов [A-Za-z0-9_-] (клиент делает его из crypto.randomUUID). */
export function parseToken(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(raw) ? raw : null;
}
