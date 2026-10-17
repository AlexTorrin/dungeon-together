import { createEndpoint, createRouter } from '@colyseus/core';
import {
  PROFILE_ACTION_PATH,
  PROFILE_PATH,
  applyHubAction,
  parseHubAction,
  parseToken,
  type Profile,
} from '@dt/shared';
import type { ProfileStore } from './ProfileStore';

/** Токен из заголовка `Authorization: Bearer <токен>`; null — нет или негодный. */
function tokenOf(headers: Headers | undefined): string | null {
  const header = headers?.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return match ? parseToken(match[1]) : null;
}

/**
 * HTTP-маршруты лагеря. Профиль меняется только здесь и в DungeonRoom — правилами из shared;
 * клиент присылает намерение («купить лук»), а не готовый профиль.
 */
export function createRoutes(store: ProfileStore) {
  const getProfile = createEndpoint(PROFILE_PATH, { method: 'GET' }, async (ctx) => {
    const token = tokenOf(ctx.headers);
    if (!token) throw ctx.error('UNAUTHORIZED', { message: 'Нужен токен игрока' });
    return store.get(token);
  });

  const postAction = createEndpoint(
    PROFILE_ACTION_PATH,
    { method: 'POST' },
    async (ctx): Promise<Profile> => {
      const token = tokenOf(ctx.headers);
      if (!token) throw ctx.error('UNAUTHORIZED', { message: 'Нужен токен игрока' });
      const action = parseHubAction(ctx.body);
      if (!action) throw ctx.error('BAD_REQUEST', { message: 'Непонятное действие' });
      const next = applyHubAction(store.get(token), action);
      if (!next) throw ctx.error('CONFLICT', { message: 'Так нельзя' });
      await store.set(token, next);
      return next;
    },
  );

  return createRouter({ getProfile, postAction });
}
