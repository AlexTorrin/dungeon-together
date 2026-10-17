import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, type CreateOptions, type JoinOptions } from '@dt/shared';

/** Порт сервера по умолчанию; совпадает с packages/server/src/index.ts. */
const DEFAULT_PORT = 2567;

/**
 * Адрес сервера: VITE_SERVER_URL, а по умолчанию — тот же хост, с которого открыта игра. Так
 * друг в локальной сети, открывший http://<ваш-ip>:5173, подключится к серверу на вашей машине.
 */
export function serverUrl(): string {
  const configured: unknown = import.meta.env['VITE_SERVER_URL'];
  if (typeof configured === 'string' && configured) return configured;
  return `${location.protocol}//${location.hostname}:${DEFAULT_PORT}`;
}

const client = (): Client => new Client(serverUrl());

export function createRoom(options: CreateOptions & JoinOptions): Promise<Room> {
  return client().create(ROOM_NAME, options);
}

export function joinRoom(code: string, options: JoinOptions): Promise<Room> {
  return client().joinById(code, options);
}

/** Вернуться в комнату после перезагрузки страницы (пока сервер держит место). */
export function reconnectRoom(reconnectionToken: string): Promise<Room> {
  return client().reconnect(reconnectionToken);
}

/** Понятный игроку текст ошибки подключения. */
export function connectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return 'Комнаты с таким кодом нет (или игра в ней уже идёт)';
  if (/locked|full/i.test(message)) return 'В комнату нельзя войти: она полна или игра уже идёт';
  return `Нет связи с сервером ${serverUrl()} — запущен ли он (pnpm dev:server)?`;
}
