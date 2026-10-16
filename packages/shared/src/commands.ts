import type { Action, ActorId, Direction, PlayerId, Position } from './types';

/** Намерения игроков. Клиент шлёт только их; результат решает applyCommand. */
export type Command = {
  readonly type: 'submitAction';
  readonly playerId: PlayerId;
  readonly action: Action;
};

/** Почему актор не смог сделать шаг. */
export type BumpReason =
  | 'wall' // в клетке стена
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
  /** Ход разрешён; turn — номер только что завершённого хода. */
  | { readonly type: 'turnResolved'; readonly turn: number };
