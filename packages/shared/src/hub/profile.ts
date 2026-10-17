import { BACKPACK_SIZE } from '../config/inventory';
import { PRICES, SHOP_STOCK, sellPrice } from '../config/shop';
import type { Carried, WeaponType } from '../types';

/**
 * Профиль героя между забегами (мета-прогрессия): кошелёк, руки, рюкзак и сундук.
 * В забег уходят руки и рюкзак — ими рискуют; кошелёк и сундук в безопасности.
 * Предметы здесь — просто виды оружия: id им выдаются только в забеге.
 */
export interface Profile {
  readonly coins: number;
  readonly hands: WeaponType | null;
  readonly backpack: readonly WeaponType[];
  readonly chest: readonly WeaponType[];
}

/** С чем герой идёт в забег. */
export interface Loadout {
  readonly weapon: WeaponType | null;
  readonly backpack: readonly WeaponType[];
}

/** Первый забег — с пустыми руками и без монет. */
export const EMPTY_PROFILE: Profile = { coins: 0, hands: null, backpack: [], chest: [] };

/** Где лежит предмет в хабе. */
export type Slot =
  | { readonly place: 'hands' }
  | { readonly place: 'backpack'; readonly index: number }
  | { readonly place: 'chest'; readonly index: number };

/** Что лежит в слоте; null — пусто. */
export function itemAt(profile: Profile, slot: Slot): WeaponType | null {
  switch (slot.place) {
    case 'hands':
      return profile.hands;
    case 'backpack':
      return profile.backpack[slot.index] ?? null;
    case 'chest':
      return profile.chest[slot.index] ?? null;
  }
}

/** Профиль без предмета в слоте. */
function without(profile: Profile, slot: Slot): Profile {
  switch (slot.place) {
    case 'hands':
      return { ...profile, hands: null };
    case 'backpack':
      return { ...profile, backpack: profile.backpack.filter((_, i) => i !== slot.index) };
    case 'chest':
      return { ...profile, chest: profile.chest.filter((_, i) => i !== slot.index) };
  }
}

/**
 * Купить в магазине: только то, что в продаже, и если хватает монет. Покупка ложится в рюкзак,
 * а если в нём нет места — в сундук. null — нельзя.
 */
export function buy(profile: Profile, type: WeaponType): Profile | null {
  if (!SHOP_STOCK.includes(type) || profile.coins < PRICES[type]) return null;
  const paid = { ...profile, coins: profile.coins - PRICES[type] };
  return paid.backpack.length < BACKPACK_SIZE
    ? { ...paid, backpack: [...paid.backpack, type] }
    : { ...paid, chest: [...paid.chest, type] };
}

/** Продать предмет из слота за полцены. null — слот пуст. */
export function sell(profile: Profile, slot: Slot): Profile | null {
  const type = itemAt(profile, slot);
  if (!type) return null;
  const rest = without(profile, slot);
  return { ...rest, coins: rest.coins + sellPrice(type) };
}

/**
 * Переложить предмет: в руки (что было в руках, встаёт на его место), в рюкзак (если есть
 * место) или в сундук. null — нельзя (пусто, рюкзак полон, перекладывать некуда).
 */
export function move(profile: Profile, from: Slot, to: Slot['place']): Profile | null {
  const type = itemAt(profile, from);
  if (!type || from.place === to) return null;
  if (to === 'hands') {
    const rest = without(profile, from);
    const old = profile.hands;
    if (!old || from.place === 'hands') return { ...rest, hands: type };
    // Старое оружие из рук — туда, откуда взяли новое.
    return from.place === 'backpack'
      ? { ...rest, hands: type, backpack: [...rest.backpack, old] }
      : { ...rest, hands: type, chest: [...rest.chest, old] };
  }
  if (to === 'backpack') {
    if (profile.backpack.length >= BACKPACK_SIZE) return null;
    const rest = without(profile, from);
    return { ...rest, backpack: [...rest.backpack, type] };
  }
  const rest = without(profile, from);
  return { ...rest, chest: [...rest.chest, type] };
}

/**
 * Начать забег: руки и рюкзак уходят в забег (из профиля их убираем сразу — бросил забег
 * или погиб, вещей больше нет). Кошелёк и сундук остаются дома.
 */
export function startRun(profile: Profile): {
  readonly profile: Profile;
  readonly loadout: Loadout;
} {
  return {
    profile: { ...profile, hands: null, backpack: [] },
    loadout: { weapon: profile.hands, backpack: profile.backpack },
  };
}

/**
 * Закончить забег: вынесенное (Carried из state.escaped) возвращается — монеты в кошелёк,
 * оружие в руки (если пусты), иначе в рюкзак, а что не влезло — в сундук. Добавляем, а не
 * заменяем: профиль мог измениться, пока шёл забег (тот же игрок в другой комнате).
 * Не вынес (погиб, бросил) — ничего не добавляется.
 */
export function finishRun(profile: Profile, carried: Carried | undefined): Profile {
  if (!carried) return profile;
  let hands = profile.hands;
  const backpack = [...profile.backpack];
  const chest = [...profile.chest];
  const returned = [
    ...(carried.weapon ? [carried.weapon.type] : []),
    ...carried.backpack.map((i) => i.type),
  ];
  for (const type of returned) {
    if (!hands) hands = type;
    else if (backpack.length < BACKPACK_SIZE) backpack.push(type);
    else chest.push(type);
  }
  return { coins: profile.coins + carried.coins, hands, backpack, chest };
}
