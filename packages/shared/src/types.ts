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

export type Direction = 'up' | 'down' | 'left' | 'right';

export type MonsterSpecies = 'skeleton' | 'skull' | 'vampire';
export type WeaponType = 'bone' | 'darts' | 'fireFlask' | 'bigFlask';

/** Расстановка в комнате (то, что рисует редактор); id появляются только в GameState. */
export interface RoomMonster {
  readonly species: MonsterSpecies;
  readonly pos: Position;
}

export interface RoomItem {
  readonly type: WeaponType;
  readonly pos: Position;
}

/** Комната: карта, точка появления игроков, монстры и предметы. Единица, которую делает редактор. */
export interface Room {
  readonly map: GameMap;
  readonly spawn: Position;
  readonly monsters: readonly RoomMonster[];
  readonly items: readonly RoomItem[];
}

/** id любого участника хода — игрока или монстра. */
export type ActorId = string;
export type PlayerId = ActorId;
export type ItemId = string;

export interface Item {
  readonly id: ItemId;
  readonly type: WeaponType;
}

/** Предмет, лежащий на полу. Предмет в руках хранится в Actor.weapon. */
export interface GroundItem extends Item {
  readonly pos: Position;
}

interface ActorBase {
  readonly id: ActorId;
  readonly pos: Position;
  readonly hp: number;
  readonly maxHp: number;
  /** Одно оружие в руках или ничего (тогда бьёт кулаками). */
  readonly weapon: Item | null;
}

export interface PlayerActor extends ActorBase {
  readonly kind: 'player';
}

export interface MonsterActor extends ActorBase {
  readonly kind: 'monster';
  readonly species: MonsterSpecies;
}

export type Actor = PlayerActor | MonsterActor;

/** Что актор делает в этот ход. */
export type Action =
  | { readonly type: 'move'; readonly direction: Direction }
  | { readonly type: 'attack'; readonly direction: Direction }
  | { readonly type: 'wait' };

export type GameStatus = 'playing' | 'won' | 'lost';

/**
 * Модель ходов — одновременная: каждый игрок выбирает действие (pendingActions),
 * когда выбрали все — ход разрешается разом и turn увеличивается.
 * Мёртвые акторы удаляются из actors.
 */
export interface GameState {
  readonly map: GameMap;
  readonly actors: Readonly<Record<ActorId, Actor>>;
  readonly items: Readonly<Record<ItemId, GroundItem>>;
  readonly turn: number;
  readonly pendingActions: Readonly<Record<PlayerId, Action>>;
  readonly status: GameStatus;
}
