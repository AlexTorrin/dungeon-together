import { BACKPACK_SIZE } from '../config/inventory';
import { PRICES, SHOP_STOCK, sellPrice } from '../config/shop';
import { isArmorType } from '../items';
import type { ArmorType, Carried, ItemType, WeaponType } from '../types';

/**
 * Профиль героя между забегами (мета-прогрессия): кошелёк, руки, броня, рюкзак и сундук.
 * В забег уходят руки, броня и рюкзак — ими рискуют; кошелёк и сундук в безопасности.
 * Предметы здесь — просто виды оружия: id им выдаются только в забеге.
 */
export interface Profile {
  readonly coins: number;
  /** В руках — только оружие. */
  readonly hands: WeaponType | null;
  /** Надето — только броня. */
  readonly armor: ArmorType | null;
  readonly backpack: readonly ItemType[];
  readonly chest: readonly ItemType[];
}

/** С чем герой идёт в забег. */
export interface Loadout {
  readonly weapon: WeaponType | null;
  readonly armor: ArmorType | null;
  readonly backpack: readonly ItemType[];
}

/** Первый забег — с пустыми руками и без монет. */
export const EMPTY_PROFILE: Profile = {
  coins: 0,
  hands: null,
  armor: null,
  backpack: [],
  chest: [],
};

/** Где лежит предмет в хабе. */
export type Slot =
  | { readonly place: 'hands' }
  | { readonly place: 'armor' }
  | { readonly place: 'backpack'; readonly index: number }
  | { readonly place: 'chest'; readonly index: number };

/** Что лежит в слоте; null — пусто. */
export function itemAt(profile: Profile, slot: Slot): ItemType | null {
  switch (slot.place) {
    case 'hands':
      return profile.hands;
    case 'armor':
      return profile.armor;
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
    case 'armor':
      return { ...profile, armor: null };
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
export function buy(profile: Profile, type: ItemType): Profile | null {
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
 * Переложить предмет: в руки (только оружие) или надеть (только броню) — что было в руках
 * (надето), встаёт на его место; в рюкзак (если есть место) или в сундук.
 * null — нельзя (пусто, рюкзак полон, баночку в руки и т.п.).
 */
export function move(profile: Profile, from: Slot, to: Slot['place']): Profile | null {
  const type = itemAt(profile, from);
  if (!type || from.place === to) return null;
  if (to === 'hands' || to === 'armor') {
    const rest = without(profile, from);
    let worn: Profile;
    if (to === 'armor' && isArmorType(type)) worn = { ...rest, armor: type };
    else if (to === 'hands' && type !== 'potion' && !isArmorType(type))
      worn = { ...rest, hands: type };
    else return null;
    const old = profile[to];
    if (!old) return worn;
    // Старое из рук (с себя) — туда, откуда взяли новое.
    return from.place === 'backpack'
      ? { ...worn, backpack: [...worn.backpack, old] }
      : { ...worn, chest: [...worn.chest, old] };
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
 * Начать забег: руки, броня и рюкзак уходят в забег (из профиля их убираем сразу — бросил забег
 * или погиб, вещей больше нет). Кошелёк и сундук остаются дома.
 */
export function startRun(profile: Profile): {
  readonly profile: Profile;
  readonly loadout: Loadout;
} {
  return {
    profile: { ...profile, hands: null, armor: null, backpack: [] },
    loadout: { weapon: profile.hands, armor: profile.armor, backpack: profile.backpack },
  };
}

/**
 * Закончить забег: вынесенное (Carried из state.escaped) возвращается — монеты в кошелёк,
 * оружие в руки (если пусты), броня — на героя (если без брони), иначе в рюкзак, а что не
 * влезло — в сундук. Добавляем, а не
 * заменяем: профиль мог измениться, пока шёл забег (тот же игрок в другой комнате).
 * Не вынес (погиб, бросил) — ничего не добавляется.
 */
export function finishRun(profile: Profile, carried: Carried | undefined): Profile {
  if (!carried) return profile;
  let { hands, armor } = profile;
  const backpack = [...profile.backpack];
  const chest = [...profile.chest];
  const returned = [
    ...(carried.weapon ? [carried.weapon.type] : []),
    ...(carried.armor ? [carried.armor.type] : []),
    ...carried.backpack.map((i) => i.type),
  ];
  for (const type of returned) {
    if (!armor && isArmorType(type)) armor = type;
    else if (!hands && type !== 'potion' && !isArmorType(type)) hands = type;
    else if (backpack.length < BACKPACK_SIZE) backpack.push(type);
    else chest.push(type);
  }
  return { coins: profile.coins + carried.coins, hands, armor, backpack, chest };
}
