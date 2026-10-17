import { MAX_PLAYERS, type PlayerId } from '@dt/shared';

/**
 * Свободный id игрока: p1…p4, наименьший незанятый. Номер — это и цвет/место героя, поэтому
 * вернувшийся в лобби получит освободившийся номер, а не p5.
 */
export function freePlayerId(taken: Iterable<PlayerId>): PlayerId | null {
  const used = new Set(taken);
  for (let n = 1; n <= MAX_PLAYERS; n++) {
    const id = `p${n}`;
    if (!used.has(id)) return id;
  }
  return null;
}
