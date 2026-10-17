import { parseToken } from '@dt/shared';
import { randomId } from './randomId';

const STORAGE_KEY = 'dt.token.v1';
/** Если localStorage недоступен — токен живёт до перезагрузки страницы. */
let memoryToken: string | null = null;

/**
 * Токен игрока: случайный, создаётся при первом обращении и хранится в браузере. По нему
 * сервер находит профиль. Потерять токен (очистить данные сайта, другой браузер) —
 * потерять профиль: логина пока нет.
 */
export function playerToken(): string {
  try {
    const stored = parseToken(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
    const token = randomId();
    localStorage.setItem(STORAGE_KEY, token);
    return token;
  } catch (error: unknown) {
    console.warn('localStorage недоступен — профиль будет новым после перезагрузки', error);
    memoryToken ??= randomId();
    return memoryToken;
  }
}
