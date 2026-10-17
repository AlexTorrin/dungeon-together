import {
  canAttack,
  chebyshev,
  isInBounds,
  samePos,
  step,
  weaponOf,
  type Actor,
  type Direction,
  type GameState,
  type Position,
} from '@dt/shared';

/**
 * Прицел с клавиатуры: курсор цели, который ходит по клеткам в пределах дальности оружия.
 * Логика без Phaser — сцена только переключает режим и рисует курсор.
 */

/** Кого можно ударить прямо сейчас: ближние первыми, при равенстве — по id. */
export function aimTargets(state: GameState, me: Actor): Position[] {
  return Object.values(state.actors)
    .filter((a) => a.id !== me.id && canAttack(state.map, me, a.pos))
    .sort((a, b) => chebyshev(me.pos, a.pos) - chebyshev(me.pos, b.pos) || a.id.localeCompare(b.id))
    .map((a) => a.pos);
}

/** С чего начать прицел: ближайшая цель, иначе — клетка героя (курсор надо будет сдвинуть). */
export function initialAim(state: GameState, me: Actor): Position {
  return aimTargets(state, me)[0] ?? me.pos;
}

/** Сдвиг курсора на клетку; за пределы карты и дальности оружия курсор не уходит. */
export function moveAim(
  state: GameState,
  me: Actor,
  aim: Position,
  direction: Direction,
): Position {
  const next = step(aim, direction);
  const inRange = chebyshev(me.pos, next) <= weaponOf(me).range;
  return inRange && isInBounds(state.map, next) ? next : aim;
}

/** Следующая цель после текущей (по кругу); null — целей нет. */
export function nextAimTarget(state: GameState, me: Actor, aim: Position): Position | null {
  const targets = aimTargets(state, me);
  const i = targets.findIndex((t) => samePos(t, aim));
  return targets[(i + 1) % targets.length] ?? null;
}
