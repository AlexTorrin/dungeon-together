import type { BumpReason } from '../commands';
import { step } from '../direction';
import { isWalkable } from '../map/gameMap';
import type { Action, ActorId, GameMap, Position } from '../types';

export interface ActorIntent {
  readonly id: ActorId;
  readonly from: Position;
  readonly action: Action;
}

export type MoveOutcome =
  | { readonly kind: 'moved'; readonly to: Position }
  | { readonly kind: 'bumped'; readonly at: Position; readonly reason: BumpReason }
  | { readonly kind: 'waited' };

const key = ({ x, y }: Position): string => `${x},${y}`;

/**
 * Одновременное разрешение шагов. Все акторы двигаются «в один момент», поэтому
 * результат не зависит от порядка, в котором они выбирали действия:
 *
 * 1. Шаг в стену сразу проваливается.
 * 2. Дальше повторяем, пока что-то меняется (провал одного может вызвать провал другого):
 *    - несколько акторов целятся в одну клетку → проваливаются все;
 *    - цель занята тем, кто остаётся на месте → провал;
 *    - двое меняются местами → провал у обоих.
 * Шаг в клетку, которую сосед в этот же ход успешно освобождает, разрешён (цепочки работают).
 */
export function resolveMoves(
  map: GameMap,
  intents: readonly ActorIntent[],
): ReadonlyMap<ActorId, MoveOutcome> {
  const targets = new Map<ActorId, Position>();
  const outcomes = new Map<ActorId, MoveOutcome>();

  for (const { id, from, action } of intents) {
    if (action.type === 'wait') {
      outcomes.set(id, { kind: 'waited' });
      continue;
    }
    const to = step(from, action.direction);
    if (isWalkable(map, to)) targets.set(id, to);
    else outcomes.set(id, { kind: 'bumped', at: to, reason: 'wall' });
  }

  const byStart = new Map(intents.map((intent) => [key(intent.from), intent.id]));
  const fail = (id: ActorId, reason: BumpReason): void => {
    const at = targets.get(id);
    if (!at) return;
    targets.delete(id);
    outcomes.set(id, { kind: 'bumped', at, reason });
  };

  let changed = true;
  while (changed) {
    changed = false;

    const claims = new Map<string, ActorId[]>();
    for (const [id, to] of targets) {
      const claimants = claims.get(key(to)) ?? [];
      claimants.push(id);
      claims.set(key(to), claimants);
    }
    for (const claimants of claims.values()) {
      if (claimants.length < 2) continue;
      for (const id of claimants) fail(id, 'contested');
      changed = true;
    }

    for (const [id, to] of [...targets]) {
      const occupant = byStart.get(key(to));
      if (occupant === undefined || occupant === id) continue;
      const occupantTarget = targets.get(occupant);
      const from = intents.find((intent) => intent.id === id)?.from;
      if (!occupantTarget) {
        fail(id, 'occupied');
        changed = true;
      } else if (from && key(occupantTarget) === key(from)) {
        fail(id, 'swap');
        fail(occupant, 'swap');
        changed = true;
      }
    }
  }

  for (const [id, to] of targets) outcomes.set(id, { kind: 'moved', to });
  return outcomes;
}
