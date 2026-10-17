import type { WeaponType } from '../types';

/** Цена покупки. Меч и палочку магазин не продаёт (только добыча), но цена нужна для продажи. */
export const PRICES: Readonly<Record<WeaponType, number>> = {
  knife: 2,
  bow: 2,
  sword: 6,
  wand: 8,
};

/** Что продаётся в магазине. */
export const SHOP_STOCK: readonly WeaponType[] = ['knife', 'bow'];

/** Продажа — за половину цены покупки, с округлением вниз. */
export function sellPrice(type: WeaponType): number {
  return Math.floor(PRICES[type] / 2);
}
