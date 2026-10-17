import { ACTION_POINTS, actionCost } from '../config/turn';
import { step } from '../direction';
import { canStep } from '../map/pathfinding';
import type { Action, Actor, GameMap, Plan, Position } from '../types';
import { canAttack } from './combat';

const WAIT: Action = { type: 'wait' };

/**
 * План хода по фазам: что актор делает в каждой из ACTION_POINTS фаз. Действие ценой
 * больше 1 ОД занимает несколько фаз и срабатывает в последней (раньше — замах, стоит на месте).
 * Недостающие фазы — ожидание. null — план дороже, чем есть ОД.
 */
export function planPhases(plan: Plan): Action[] | null {
  const phases: Action[] = [];
  for (const action of plan) {
    const cost = actionCost(action);
    for (let i = 1; i < cost; i++) phases.push(WAIT);
    phases.push(action);
  }
  if (phases.length > ACTION_POINTS) return null;
  while (phases.length < ACTION_POINTS) phases.push(WAIT);
  return phases;
}

/**
 * Где актор окажется к началу каждой фазы, если его шаги удадутся (без учёта других акторов —
 * их выбор неизвестен). По этим позициям проверяются удары плана и рисуются намерения.
 */
export function expectedPositions(
  map: GameMap,
  from: Position,
  phases: readonly Action[],
): Position[] {
  const positions: Position[] = [];
  let pos = from;
  for (const action of phases) {
    positions.push(pos);
    if (action.type === 'move' && canStep(map, pos, action.direction))
      pos = step(pos, action.direction);
  }
  return positions;
}

/** Можно ли отправить план: укладывается в ОД, каждый удар достаёт с ожидаемой позиции. */
export function isPlanValid(map: GameMap, actor: Actor, plan: Plan): boolean {
  const phases = planPhases(plan);
  if (!phases || plan.length === 0) return false;
  const positions = expectedPositions(map, actor.pos, phases);
  return phases.every((action, i) => {
    const pos = positions[i];
    return (
      action.type !== 'attack' ||
      (pos !== undefined && canAttack(map, { ...actor, pos }, action.target))
    );
  });
}
