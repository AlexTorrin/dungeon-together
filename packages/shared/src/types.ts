export interface Position {
  readonly x: number;
  readonly y: number;
}

export type Tile = 'wall' | 'floor';

/** Сетка тайлов, хранится построчно: tiles[y * width + x]. */
export interface GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly Tile[];
}

/** Комната: карта + точка появления игроков. Единица, которую делает редактор. */
export interface Room {
  readonly map: GameMap;
  readonly spawn: Position;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export type PlayerId = string;

/** id любого участника хода: игрока, а позже и монстра. */
export type ActorId = string;

export interface Player {
  readonly id: PlayerId;
  readonly pos: Position;
}

/** Что игрок выбрал на текущий ход. */
export type Action =
  { readonly type: 'move'; readonly direction: Direction } | { readonly type: 'wait' };

/**
 * Модель ходов — одновременная: каждый игрок выбирает действие (pendingActions),
 * когда выбрали все — ход разрешается разом и turn увеличивается.
 */
export interface GameState {
  readonly map: GameMap;
  readonly players: Readonly<Record<PlayerId, Player>>;
  readonly turn: number;
  readonly pendingActions: Readonly<Record<PlayerId, Action>>;
}
