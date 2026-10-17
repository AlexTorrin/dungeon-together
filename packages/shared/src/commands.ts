import type { ActorId, Direction, GameStatus, ItemId, Plan, PlayerId, Position } from './types';

/** Намерения игроков. Клиент шлёт только их; результат решает applyCommand. */
export type Command =
  | { readonly type: 'submitPlan'; readonly playerId: PlayerId; readonly plan: Plan }
  /** Отозвать отправленный план, пока ход не разрешён (передумал). */
  | { readonly type: 'cancelPlan'; readonly playerId: PlayerId };

/** Почему план не принят — чтобы клиент не ждал вечно и мог объяснить игроку. */
export type PlanRejectReason =
  | 'gameOver' // игра уже закончилась
  | 'alreadySubmitted' // план на этот ход уже есть (сначала cancelPlan)
  | 'invalidPlan'; // дороже ОД или удар не достаёт с ожидаемой позиции

/** Почему актор не смог сделать шаг. */
export type BumpReason =
  | 'wall' // в клетке стена (или диагональ срезает угол стены)
  | 'occupied' // в клетке кто-то, кто в этот ход остаётся на месте
  | 'contested' // в эту же клетку в этот ход идёт кто-то ещё
  | 'swap'; // двое пытаются поменяться местами

/** Что произошло в результате команды — клиент проигрывает это как анимации. */
export type GameEvent =
  | { readonly type: 'planSubmitted'; readonly playerId: PlayerId; readonly turn: number }
  | {
      readonly type: 'planRejected';
      readonly playerId: PlayerId;
      readonly reason: PlanRejectReason;
    }
  | { readonly type: 'planCancelled'; readonly playerId: PlayerId; readonly turn: number }
  | {
      readonly type: 'moved';
      readonly actorId: ActorId;
      readonly from: Position;
      readonly to: Position;
      readonly direction: Direction;
    }
  | {
      readonly type: 'bumped';
      readonly actorId: ActorId;
      readonly at: Position;
      readonly direction: Direction;
      readonly reason: BumpReason;
    }
  | { readonly type: 'waited'; readonly actorId: ActorId }
  /** Удар по клетке — даже если там никого не оказалось. */
  | { readonly type: 'attacked'; readonly actorId: ActorId; readonly target: Position }
  /** Актор получил урон; hp — сколько осталось (может быть ≤ 0, тогда следом died). */
  | {
      readonly type: 'damaged';
      readonly actorId: ActorId;
      readonly by: ActorId;
      readonly amount: number;
      readonly hp: number;
    }
  | { readonly type: 'died'; readonly actorId: ActorId; readonly at: Position }
  /** Актор поднял предмет с пола в рюкзак. */
  | { readonly type: 'itemPickedUp'; readonly actorId: ActorId; readonly itemId: ItemId }
  /** Актор взял предмет из рюкзака в руки. */
  | { readonly type: 'itemEquipped'; readonly actorId: ActorId; readonly itemId: ItemId }
  /** Предмет упал на пол: выбросил (drop) или выронил при смерти. */
  | {
      readonly type: 'itemDropped';
      readonly actorId: ActorId;
      readonly itemId: ItemId;
      readonly at: Position;
    }
  | { readonly type: 'gameOver'; readonly status: Exclude<GameStatus, 'playing'> }
  /** Фаза хода разрешена (1, 2, …): клиент проигрывает фазы по очереди. */
  | { readonly type: 'phaseResolved'; readonly phase: number }
  /** Ход разрешён; turn — номер только что завершённого хода. */
  | { readonly type: 'turnResolved'; readonly turn: number };
