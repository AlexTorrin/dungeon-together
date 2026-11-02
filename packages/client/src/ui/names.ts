import { t } from '../i18n';
import type { Difficulty } from '@dt/shared';

/** Локализованные названия предметов для HUD и меню; none — без оружия в руках, noArmor — без брони. */
export const ITEM_NAMES = {
  get none() {
    return t('names.fists');
  },
  get knife() {
    return t('names.knife');
  },
  get bow() {
    return t('names.bow');
  },
  get sword() {
    return t('names.sword');
  },
  get wand() {
    return t('names.wand');
  },
  get potion() {
    return t('names.potion');
  },
  get leather() {
    return t('names.leather');
  },
  get mail() {
    return t('names.chainmail');
  },
  get noArmor() {
    return t('names.none');
  },
} as const;

export const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = {
  get easy() {
    return t('names.easy');
  },
  get medium() {
    return t('names.normal');
  },
  get hard() {
    return t('names.hard');
  },
};
