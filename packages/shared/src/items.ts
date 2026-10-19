import { ARMORS } from './config/armor';
import type {
  ArmorItem,
  ArmorType,
  GroundItem,
  Item,
  ItemId,
  ItemType,
  Position,
  WeaponItem,
} from './types';

/** Вид брони ли это (в т.ч. для недоверенных данных). */
export const isArmorType = (value: unknown): value is ArmorType =>
  typeof value === 'string' && Object.hasOwn(ARMORS, value);

/** Оружие ли это (его можно взять в руки), а не броня или баночка. */
export const isWeapon = (item: Item): item is WeaponItem =>
  item.type !== 'potion' && !isArmorType(item.type);

/** Броня ли это (её можно надеть). */
export const isArmor = (item: Item): item is ArmorItem => isArmorType(item.type);

/** Предмет вида type с id (в забеге: из профиля, с пола). */
export function makeItem(id: ItemId, type: ItemType): Item {
  if (type === 'potion') return { id, type };
  if (isArmorType(type)) return { id, type };
  return { id, type };
}

/** Всё, что актор несёт: оружие в руках, надетая броня, рюкзак. */
export const carriedItems = (actor: {
  readonly weapon: WeaponItem | null;
  readonly armor: ArmorItem | null;
  readonly backpack: readonly Item[];
}): Item[] => [
  ...(actor.weapon ? [actor.weapon] : []),
  ...(actor.armor ? [actor.armor] : []),
  ...actor.backpack,
];

/** Предмет из рук, с актора или из рюкзака, упавший на пол (выбросил, выронил при смерти): id тот же. */
export function onGround(item: Item, pos: Position): GroundItem {
  if (item.type === 'potion') return { kind: 'potion', id: item.id, pos };
  if (isArmor(item)) return { kind: 'armor', id: item.id, type: item.type, pos };
  return { kind: 'weapon', id: item.id, type: item.type, pos };
}

/** Предмет с пола, который ляжет в рюкзак; монеты и ключ — не предметы (null). */
export function inHands(ground: GroundItem): Item | null {
  switch (ground.kind) {
    case 'weapon':
    case 'armor':
      return { id: ground.id, type: ground.type };
    case 'potion':
      return { id: ground.id, type: 'potion' };
    case 'coins':
    case 'key':
      return null;
  }
}
