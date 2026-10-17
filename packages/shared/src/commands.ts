import type { Action, ActorId, Direction, GameStatus, ItemId, PlayerId, Position } from './types';

/** Намерения игроков. Клиент шлёт только их; результат решает applyCommand. */
export type Command = {
  readonly type: 'submitAction';
  readonly playerId: PlayerId;
  readonly action: Action;
};

/** Почему актор не смог сделать шаг. */
export type BumpReason =
  | 'wall' // в клетке стена (или диагональ срезает угол стены)
  | 'occupied' // в клетке кто-то, кто в этот ход остаётся на месте
  | 'contested' // в эту же клетку в этот ход идёт кто-то ещё
  | 'swap'; // двое пытаются поменяться местами

/** Что произошло в результате команды — клиент проигрывает это как анимации. */
export type GameEvent =
  | { readonly type: 'actionSubmitted'; readonly playerId: PlayerId; readonly turn: number }
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
  /** Актор поднял предмет с пола (своё старое оружие, если было, кладёт на эту клетку). */
  | { readonly type: 'itemPickedUp'; readonly actorId: ActorId; readonly itemId: ItemId }
  | { readonly type: 'itemDropped'; readonly itemId: ItemId; readonly at: Position }
  | { readonly type: 'gameOver'; readonly status: Exclude<GameStatus, 'playing'> }
  /** Ход разрешён; turn — номер только что завершённого хода. */
  | { readonly type: 'turnResolved'; readonly turn: number };
