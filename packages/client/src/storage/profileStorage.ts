import { BACKPACK_SIZE, EMPTY_PROFILE, WEAPONS, type Profile, type WeaponType } from '@dt/shared';

const STORAGE_KEY = 'dt.profile.v1';

function isWeaponType(value: unknown): value is WeaponType {
  return typeof value === 'string' && Object.hasOwn(WEAPONS, value);
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const { coins, hands, backpack, chest } = v;
  return (
    typeof coins === 'number' &&
    Number.isInteger(coins) &&
    coins >= 0 &&
    (hands === null || isWeaponType(hands)) &&
    Array.isArray(backpack) &&
    backpack.length <= BACKPACK_SIZE &&
    backpack.every(isWeaponType) &&
    Array.isArray(chest) &&
    chest.every(isWeaponType)
  );
}

/**
 * Профиль героя из localStorage. Нет записи — первый забег с пустыми руками. Битая запись
 * тоже даёт пустой профиль, но о ней пишем в консоль: это потеря прогресса, а не норма.
 */
export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_PROFILE;
    const parsed: unknown = JSON.parse(raw);
    if (isProfile(parsed)) return parsed;
    console.warn('Профиль в localStorage повреждён, начинаем с пустого', parsed);
  } catch (error: unknown) {
    console.warn('Не удалось прочитать профиль', error);
  }
  return EMPTY_PROFILE;
}

/** Сохраняет профиль; false — не вышло (хранилище недоступно или переполнено). */
export function saveProfile(profile: Profile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch (error: unknown) {
    console.warn('Не удалось сохранить профиль', error);
    return false;
  }
}
