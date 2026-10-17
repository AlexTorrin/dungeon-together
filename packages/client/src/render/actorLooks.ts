import type { Actor, MonsterSpecies, PlayerId } from '@dt/shared';
import { ANIMATIONS, lookOf, type Look } from '../assetKeys';

const MONSTER_LOOKS: Readonly<Record<MonsterSpecies, Look>> = {
  skeleton: lookOf(ANIMATIONS.skeletonIdle),
  skull: lookOf(ANIMATIONS.skullIdle),
  vampire: lookOf(ANIMATIONS.vampireIdle),
};

const OTHER_PLAYER_LOOK = lookOf(ANIMATIONS.otherPlayerIdle);

/**
 * Как нарисовать актора. Внешний вид — дело клиента, в shared его нет:
 * у локальных игроков свой облик, остальные игроки — общий «чужой», монстры — по виду.
 */
export function lookOfActor(actor: Actor, localLooks: ReadonlyMap<PlayerId, Look>): Look {
  if (actor.kind === 'monster') return MONSTER_LOOKS[actor.species];
  return localLooks.get(actor.id) ?? OTHER_PLAYER_LOOK;
}
