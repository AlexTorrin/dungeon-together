import type { GroundItem, Item, Position, WeaponItem } from './types';

/** Оружие ли это (его можно взять в руки), а не баночка. */
export const isWeapon = (item: Item): item is WeaponItem => item.type !== 'potion';

/** Предмет из рук или рюкзака, упавший на пол (выбросил, выронил при смерти): id тот же. */
export function onGround(item: Item, pos: Position): GroundItem {
  return item.type === 'potion'
    ? { kind: 'potion', id: item.id, pos }
    : { kind: 'weapon', id: item.id, type: item.type, pos };
}

/** Предмет с пола, который ляжет в рюкзак; монеты и ключ — не предметы (null). */
export function inHands(ground: GroundItem): Item | null {
  switch (ground.kind) {
    case 'weapon':
      return { id: ground.id, type: ground.type };
    case 'potion':
      return { id: ground.id, type: 'potion' };
    case 'coins':
    case 'key':
      return null;
  }
}
