import type { Action, Item } from '../types';
import { UNARMED, WEAPONS } from './weapons';

/** Очков действия на ход. Ход делится на столько же фаз: одно ОД — одна фаза. */
export const ACTION_POINTS = 2;

/**
 * Сколько ОД стоит действие при оружии weapon в руках: удар — по оружию (меч — 2),
 * всё остальное — 1.
 */
export function actionCost(action: Action, weapon: Item | null): number {
  switch (action.type) {
    case 'attack':
      return weapon ? WEAPONS[weapon.type].cost : UNARMED.cost;
    case 'move':
    case 'wait':
    case 'equip':
    case 'drop':
    case 'dropCoins':
    case 'dropKey':
    case 'openDoor':
      return 1;
  }
}
