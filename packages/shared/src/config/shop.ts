import type { ItemType } from '../types';

/** Цена покупки. Меч и палочку магазин не продаёт (только добыча), но цена нужна для продажи. */
export const PRICES: Readonly<Record<ItemType, number>> = {
  knife: 2,
  bow: 2,
  sword: 6,
  wand: 8,
  potion: 10,
};

/** Что продаётся в магазине. */
export const SHOP_STOCK: readonly ItemType[] = ['knife', 'bow', 'potion'];

/** Продажа — за половину цены покупки, с округлением вниз. */
export function sellPrice(type: ItemType): number {
  return Math.floor(PRICES[type] / 2);
}
