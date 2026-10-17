import { UNARMED, WEAPONS, type WeaponStats } from '../config/weapons';
import { isWalkable } from '../map/gameMap';
import { canSee, visibleFrom } from '../map/fov';
import { chebyshev, posKey, samePos } from '../map/geometry';
import type { Actor, GameMap, Position } from '../types';

export function weaponOf(actor: Actor): WeaponStats {
  return actor.weapon ? WEAPONS[actor.weapon.type] : UNARMED;
}

/**
 * Радиус поля зрения, которым проверяем удар. Дальность оружия — квадрат (по Чебышёву),
 * а поле зрения rot.js — круг, поэтому берём круг, описанный вокруг квадрата.
 */
const sightFor = (range: number): number => Math.ceil(range * Math.SQRT2);

/**
 * Может ли актор ударить клетку: это пол, не своя клетка, в пределах дальности оружия
 * (по Чебышёву, с диагоналями) и он её видит (то же поле зрения, что и для тумана войны).
 * Кто там стоит — не важно: бить можно и пустое место.
 */
export function canAttack(map: GameMap, attacker: Actor, target: Position): boolean {
  if (samePos(attacker.pos, target) || !isWalkable(map, target)) return false;
  const { range } = weaponOf(attacker);
  if (chebyshev(attacker.pos, target) > range) return false;
  return canSee(map, attacker.pos, target, sightFor(range));
}

/** Все клетки, которые актор может ударить, — для подсветки на клиенте и для ИИ. */
export function attackableCells(map: GameMap, attacker: Actor): Position[] {
  const { range } = weaponOf(attacker);
  const visible = visibleFrom(map, attacker.pos, sightFor(range)); // одно поле зрения на все клетки
  const cells: Position[] = [];
  for (let y = attacker.pos.y - range; y <= attacker.pos.y + range; y++) {
    for (let x = attacker.pos.x - range; x <= attacker.pos.x + range; x++) {
      const cell = { x, y };
      if (!samePos(cell, attacker.pos) && isWalkable(map, cell) && visible.has(posKey(cell))) {
        cells.push(cell);
      }
    }
  }
  return cells;
}
