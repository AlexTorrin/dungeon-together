import type { Difficulty } from '@dt/shared';

/** Русские названия оружия для HUD и меню; none — без оружия. */
export const WEAPON_NAMES = {
  none: 'кулаки',
  knife: 'нож',
  bow: 'лук',
  sword: 'меч',
  wand: 'палочка',
} as const;

export const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = {
  easy: 'легко',
  medium: 'средне',
  hard: 'трудно',
};
