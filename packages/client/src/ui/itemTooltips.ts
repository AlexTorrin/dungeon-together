import { t } from '../i18n';
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
  const swing = cost > 1 ? t('itemTooltips.windUpTakesTheWholeTurn') : '';
  return t('itemTooltips.damageRangeAttackAP', damage, range, cost, swing);
}

function armorStats(type: ArmorType): string {
  return t('itemTooltips.reducesEachHitByMinimumDamage', ARMORS[type].defense, MIN_DAMAGE);
}

/** Ячейка «руки»: оружие или кулаки. */
export function handsTooltip(type: WeaponType | null): string {
  const hint = type
    ? t('itemTooltips.qDropAP', DROP_COST)
    : t('itemTooltips.equipFromBackpackPressItsSlot');
  return [capitalize(ITEM_NAMES[type ?? 'none']), weaponStats(type), hint].join('\n');
}

/** Ячейка «броня»: что надето. */
export function armorTooltip(type: ArmorType | null): string {
  if (!type) return t('itemTooltips.noArmorEquipArmorFromBackpack');
  return [capitalize(ITEM_NAMES[type]), armorStats(type)].join('\n');
}

/** Ячейка рюкзака с номером slot (1–4). */
export function backpackTooltip(item: Item | null, slot: number): string {
  if (!item) return t('itemTooltips.slotIsEmptyPickedUpItems', slot);
  const drop = t('itemTooltips.shiftDropAP', slot, DROP_COST);
  const use = (verb: string, cost: number): string => t('itemTooltips.orClickAP', slot, verb, cost);
  if (item.type === 'potion') {
    return [
      t('itemTooltips.healingPotion'),
      t('itemTooltips.restoresHPUpToMaximum', POTION.healShare * 100),
      use(t('itemTooltips.drink'), POTION.cost),
      drop,
    ].join('\n');
  }
  if (isArmor(item)) {
    return [
      capitalize(ITEM_NAMES[item.type]),
      armorStats(item.type),
      use(t('hub.wear'), EQUIP_COST),
      drop,
    ].join('\n');
  }
  return [
    capitalize(ITEM_NAMES[item.type]),
    weaponStats(item.type),
    use(t('itemTooltips.equip'), EQUIP_COST),
    drop,
  ].join('\n');
}

export function coinsTooltip(coins: number): string {
  return t('itemTooltips.coinsEscapeTheLevelToSpend', coins);
}

export const keyTooltip = (): string => t('itemTooltips.keyOpensTheExitDoorE');
