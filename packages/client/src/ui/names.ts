import type { Difficulty } from '@dt/shared';

/** Русские названия предметов для HUD и меню; none — без оружия в руках. */
export const ITEM_NAMES = {
  none: 'кулаки',
  knife: 'нож',
  bow: 'лук',
  sword: 'меч',
  wand: 'палочка',
  potion: 'баночка',
} as const;

export const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = {
  easy: 'легко',
  medium: 'средне',
  hard: 'трудно',
};
