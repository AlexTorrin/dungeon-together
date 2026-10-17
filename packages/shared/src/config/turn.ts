import type { Action } from '../types';

/** Очков действия на ход. Ход делится на столько же фаз: одно ОД — одна фаза. */
export const ACTION_POINTS = 2;

/** Сколько ОД стоит действие. Пока всё по 1; тяжёлые удары (меч, шаг 6) будут стоить 2. */
export function actionCost(action: Action): number {
  switch (action.type) {
    case 'move':
    case 'attack':
    case 'wait':
      return 1;
  }
}
