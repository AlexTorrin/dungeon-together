import type { Room } from '@colyseus/sdk';

const STORAGE_KEY = 'dt.resume.v1';

/** Чем вернуться в комнату после перезагрузки страницы. */
export interface ResumeInfo {
  readonly code: string;
  readonly reconnectionToken: string;
}

/**
 * Запоминаем комнату в sessionStorage — он переживает перезагрузку вкладки, но не её закрытие
 * и не другую вкладку: вернуться можно туда же, откуда ушли. Сервер ждёт RECONNECT_SECONDS.
 */
export function rememberRoom(room: Room): void {
  const info: ResumeInfo = { code: room.roomId, reconnectionToken: room.reconnectionToken };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(info));
  } catch (error: unknown) {
    console.warn('sessionStorage недоступен — после перезагрузки в игру не вернуться', error);
  }
}

export function forgetRoom(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // хранилище недоступно — значит, и помнить было нечего
  }
}

export function rememberedRoom(): ResumeInfo | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { code, reconnectionToken } = parsed as Record<string, unknown>;
    return typeof code === 'string' && typeof reconnectionToken === 'string'
      ? { code, reconnectionToken }
      : null;
  } catch {
    return null; // нет или битая запись — просто нечего предложить
  }
}
