import { parseName } from '@dt/shared';

const STORAGE_KEY = 'dt.name.v1';

/** Имя для сетевой игры; null — ещё не задано. */
export function loadPlayerName(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : parseName(raw);
  } catch {
    return null; // хранилище недоступно — спросим имя заново, это не потеря прогресса
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, parseName(name));
  } catch (error: unknown) {
    console.warn('Не удалось сохранить имя', error);
  }
}
