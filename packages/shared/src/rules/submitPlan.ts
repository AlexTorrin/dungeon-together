import type { Command, GameEvent, PlanRejectReason } from '../commands';
import type { GameState, PlayerActor, PlayerId } from '../types';
import type { CommandResult } from './applyCommand';
import { isPlanValid } from './plan';
import { resolveTurn } from './resolveTurn';

type SubmitPlanCommand = Extract<Command, { type: 'submitPlan' }>;
type CancelPlanCommand = Extract<Command, { type: 'cancelPlan' }>;

/** Игрок с таким id. Object.hasOwn — чтобы id вроде 'constructor' не нашёл ничего в прототипе. */
export function findPlayer(state: GameState, id: PlayerId): PlayerActor | undefined {
  if (!Object.hasOwn(state.actors, id)) return undefined;
  const actor = state.actors[id];
  return actor?.kind === 'player' ? actor : undefined;
}

/**
 * Игрок фиксирует план на текущий ход. Неизвестный id или id монстра — игнорируется молча
 * (сообщать некому). Остальные отказы — событие planRejected с причиной: план после конца игры,
 * повторный план в том же ходу, план дороже ОД или с ударом, который не достаёт с ожидаемой
 * позиции (rules/plan.ts). Состояние при отказе не меняется — клиент не ждёт ответа вечно.
 */
export function submitPlan(state: GameState, { playerId, plan }: SubmitPlanCommand): CommandResult {
  const player = findPlayer(state, playerId);
  if (!player) return { state, events: [] };
  const reject = (reason: PlanRejectReason): CommandResult => ({
    state,
    events: [{ type: 'planRejected', playerId, reason }],
  });
  if (state.status !== 'playing') return reject('gameOver');
  if (Object.hasOwn(state.pendingPlans, playerId)) return reject('alreadySubmitted');
  if (!isPlanValid(state, player, plan)) return reject('invalidPlan');

  const next: GameState = {
    ...state,
    pendingPlans: { ...state.pendingPlans, [playerId]: plan },
  };
  return resolveIfReady(next, [{ type: 'planSubmitted', playerId, turn: state.turn }]);
}

/**
 * Если планы есть у всех игроков на уровне — разрешает ход; events — то, что произошло до этого
 * (план принят, игрок ушёл). Нужно и после submitPlan, и после leave: ушедший мог быть последним,
 * кого ждали.
 */
export function resolveIfReady(state: GameState, events: readonly GameEvent[]): CommandResult {
  const players = Object.values(state.actors).filter((actor) => actor.kind === 'player');
  const everyoneReady =
    state.status === 'playing' &&
    players.length > 0 &&
    players.every((player) => Object.hasOwn(state.pendingPlans, player.id));
  if (!everyoneReady) return { state, events };
  const resolved = resolveTurn(state);
  return { state: resolved.state, events: [...events, ...resolved.events] };
}

/** Отзывает отправленный план, пока ход не разрешён. Нечего отзывать — молча ничего. */
export function cancelPlan(state: GameState, { playerId }: CancelPlanCommand): CommandResult {
  if (state.status !== 'playing' || !findPlayer(state, playerId)) return { state, events: [] };
  if (!Object.hasOwn(state.pendingPlans, playerId)) return { state, events: [] };
  const pendingPlans = Object.fromEntries(
    Object.entries(state.pendingPlans).filter(([id]) => id !== playerId),
  );
  return {
    state: { ...state, pendingPlans },
    events: [{ type: 'planCancelled', playerId, turn: state.turn }],
  };
}
