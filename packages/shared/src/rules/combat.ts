import { UNARMED, WEAPONS, type WeaponStats } from '../config/weapons';
import { isWalkable } from '../map/gameMap';
import { chebyshev, hasLineOfSight, samePos } from '../map/geometry';
import type { Actor, GameMap, Position } from '../types';

export function weaponOf(actor: Actor): WeaponStats {
  return actor.weapon ? WEAPONS[actor.weapon.type] : UNARMED;
}

/**
 * Может ли актор ударить клетку: это пол, не своя клетка, в пределах дальности оружия
 * (по Чебышёву, с диагоналями) и до неё есть прямая видимость. Кто там стоит — не важно:
 * бить можно и пустое место.
 */
export function canAttack(map: GameMap, attacker: Actor, target: Position): boolean {
  if (samePos(attacker.pos, target) || !isWalkable(map, target)) return false;
  if (chebyshev(attacker.pos, target) > weaponOf(attacker).range) return false;
  return hasLineOfSight(map, attacker.pos, target);
}

/** Все клетки, которые актор может ударить, — для подсветки на клиенте и для ИИ. */
export function attackableCells(map: GameMap, attacker: Actor): Position[] {
  const { range } = weaponOf(attacker);
  const cells: Position[] = [];
  for (let y = attacker.pos.y - range; y <= attacker.pos.y + range; y++) {
    for (let x = attacker.pos.x - range; x <= attacker.pos.x + range; x++) {
      if (canAttack(map, attacker, { x, y })) cells.push({ x, y });
    }
  }
  return cells;
}
