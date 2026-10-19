import {
  ARMORS,
  MIN_DAMAGE,
  POTION,
  UNARMED,
  WEAPONS,
  isArmor,
  type ArmorType,
  type Item,
  type WeaponType,
} from '@dt/shared';
import { ITEM_NAMES } from './names';

/** Тексты тултипов инвентаря: «Название\nхарактеристики\nкак пользоваться». */

const DROP_COST = 1;
const EQUIP_COST = 1;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function weaponStats(type: WeaponType | null): string {
  const { damage, range, cost } = type ? WEAPONS[type] : UNARMED;
  const swing = cost > 1 ? ' — замах на весь ход' : '';
  return `урон ${damage} · дальность ${range} · удар ${cost} ОД${swing}`;
}

function armorStats(type: ArmorType): string {
  return `каждый удар по вам слабее на ${ARMORS[type].defense} (но не меньше ${MIN_DAMAGE})`;
}

/** Ячейка «руки»: оружие или кулаки. */
export function handsTooltip(type: WeaponType | null): string {
  const hint = type ? `Q — выбросить (${DROP_COST} ОД)` : 'оружие из рюкзака — 1–4 по его ячейке';
  return [capitalize(ITEM_NAMES[type ?? 'none']), weaponStats(type), hint].join('\n');
}

/** Ячейка «броня»: что надето. */
export function armorTooltip(type: ArmorType | null): string {
  if (!type) return 'Без брони\nброню из рюкзака — 1–4 по её ячейке';
  return [capitalize(ITEM_NAMES[type]), armorStats(type)].join('\n');
}

/** Ячейка рюкзака с номером slot (1–4). */
export function backpackTooltip(item: Item | null, slot: number): string {
  if (!item) return `Ячейка ${slot} пуста\nсюда попадает подобранное`;
  const drop = `Shift+${slot} — выбросить (${DROP_COST} ОД)`;
  const use = (verb: string, cost: number): string => `${slot} или клик — ${verb} (${cost} ОД)`;
  if (item.type === 'potion') {
    return [
      'Баночка лечения',
      `возвращает ${POTION.healShare * 100}% HP (не выше максимума)`,
      use('выпить', POTION.cost),
      drop,
    ].join('\n');
  }
  if (isArmor(item)) {
    return [
      capitalize(ITEM_NAMES[item.type]),
      armorStats(item.type),
      use('надеть', EQUIP_COST),
      drop,
    ].join('\n');
  }
  return [
    capitalize(ITEM_NAMES[item.type]),
    weaponStats(item.type),
    use('взять в руки', EQUIP_COST),
    drop,
  ].join('\n');
}

export function coinsTooltip(coins: number): string {
  return `Монеты: ${coins}\nвынесите их с уровня — тратить в лагере\nпогибнете — пропадут`;
}

export const KEY_TOOLTIP = 'Ключ\nоткрывает дверь-выход: E, стоя рядом с дверью';
