import {
  PROFILE_ACTION_PATH,
  PROFILE_PATH,
  parseProfile,
  type HubAction,
  type Profile,
} from '@dt/shared';
import { playerToken } from '../storage/playerToken';
import { serverUrl } from './connection';

/** Ошибка лагеря с текстом для игрока. */
export class ProfileError extends Error {}

async function request(path: string, init: RequestInit = {}): Promise<Profile> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken()}` },
    });
  } catch (error: unknown) {
    console.warn('Сервер недоступен', error);
    throw new ProfileError(
      `Нет связи с сервером ${serverUrl()} — запущен ли он (pnpm dev:server)?`,
    );
  }
  if (response.status === 409) throw new ProfileError('Так нельзя');
  if (!response.ok) throw new ProfileError(`Сервер ответил ошибкой ${response.status}`);
  const profile = parseProfile(await response.json());
  if (!profile) throw new ProfileError('Сервер прислал странный профиль');
  return profile;
}

/** Профиль героя с сервера (новый игрок — пустой). */
export function fetchProfile(): Promise<Profile> {
  return request(PROFILE_PATH);
}

/** Действие в лагере; сервер применяет его и возвращает новый профиль. */
export function sendHubAction(action: HubAction): Promise<Profile> {
  return request(PROFILE_ACTION_PATH, { method: 'POST', body: JSON.stringify(action) });
}

/** Текст ошибки для игрока. */
export function profileErrorText(error: unknown): string {
  return error instanceof ProfileError ? error.message : 'Что-то пошло не так';
}
