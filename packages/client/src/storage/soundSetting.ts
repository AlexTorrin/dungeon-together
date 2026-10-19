const STORAGE_KEY = 'dt.muted.v1';

/** Выключен ли звук (клавиша M в игре). По умолчанию — включён. */
export function loadMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // хранилище недоступно — просто со звуком
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch (error: unknown) {
    console.warn('Не удалось сохранить настройку звука', error);
  }
}
