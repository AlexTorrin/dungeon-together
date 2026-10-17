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

/** 8 направлений: 4 прямых и 4 диагонали. */
export type Direction =
  'up' | 'down' | 'left' | 'right' | 'upLeft' | 'upRight' | 'downLeft' | 'downRight';

export type MonsterSpecies = 'skeleton' | 'skull' | 'vampire';
/** Оружие (характеристики — config/weapons.ts): нож и меч бьют соседнюю клетку, лук и палочка — издалека. */
export type WeaponType = 'knife' | 'bow' | 'sword' | 'wand';

/** Что может лежать на полу: оружие, кучка монет или ключ от двери-выхода. */
export type Loot =
  | { readonly kind: 'weapon'; readonly type: WeaponType }
  | { readonly kind: 'coins'; readonly amount: number }
  | { readonly kind: 'key' };

/** Расстановка в комнате (то, что рисует редактор или генератор); id появляются только в GameState. */
export interface RoomMonster {
  readonly species: MonsterSpecies;
  readonly pos: Position;
  /** Что монстр несёт с собой и роняет при смерти. */
  readonly weapon: WeaponType | null;
  readonly coins: number;
  readonly key: boolean;
}

export type RoomItem = Loot & { readonly pos: Position };

/** Комната: карта, точка появления игроков, монстры, предметы, дверь. Единица, которую делает редактор. */
export interface Room {
  readonly map: GameMap;
  readonly spawn: Position;
  readonly monsters: readonly RoomMonster[];
  readonly items: readonly RoomItem[];
  /** Дверь-выход в стене (клетка — стена, пока дверь закрыта); null — выход только через победу. */
  readonly door: Position | null;
}

/** id любого участника хода — игрока или монстра. */
export type ActorId = string;
export type PlayerId = ActorId;
export type ItemId = string;

/** Оружие у актора — в руках или в рюкзаке. */
export interface Item {
  readonly id: ItemId;
  readonly type: WeaponType;
}

/** Предмет, лежащий на полу. Подобранное оружие становится Item, монеты и ключ — счётчиками актора. */
export type GroundItem = Loot & { readonly id: ItemId; readonly pos: Position };

interface ActorBase {
  readonly id: ActorId;
  readonly pos: Position;
  readonly hp: number;
  readonly maxHp: number;
  /** Одно оружие в руках или ничего (тогда бьёт кулаками). */
  readonly weapon: Item | null;
  /** Рюкзак: до BACKPACK_SIZE предметов (config/inventory.ts). Подобранное попадает сюда. */
  readonly backpack: readonly Item[];
  /** Монеты и ключи места в рюкзаке не занимают. */
  readonly coins: number;
  readonly keys: number;
}

export interface PlayerActor extends ActorBase {
  readonly kind: 'player';
}

export interface MonsterActor extends ActorBase {
  readonly kind: 'monster';
  readonly species: MonsterSpecies;
}

export type Actor = PlayerActor | MonsterActor;

/**
 * Что актор делает в этот ход: шаг в одну из 8 сторон, удар по клетке или ожидание.
 * Удар бьёт клетку, а не актора: попадёт тот, кто окажется в ней после всех шагов
 * (или никто — бить можно и пустое место).
 */
export type Action =
  | { readonly type: 'move'; readonly direction: Direction }
  | { readonly type: 'attack'; readonly target: Position }
  | { readonly type: 'wait' }
  /** Взять в руки предмет из рюкзака; то, что было в руках, уходит в рюкзак на его место. */
  | { readonly type: 'equip'; readonly itemId: ItemId }
  /** Выбросить предмет (из рук или рюкзака) на свою клетку — например, чтобы отдать союзнику. */
  | { readonly type: 'drop'; readonly itemId: ItemId }
  /** Выбросить часть своих монет кучкой на свою клетку. */
  | { readonly type: 'dropCoins'; readonly amount: number }
  /** Выбросить ключ на свою клетку. */
  | { readonly type: 'dropKey' }
  /** Открыть дверь-выход ключом (стоя рядом); ключ тратится. */
  | { readonly type: 'openDoor' };

/**
 * План на ход: до ACTION_POINTS действий по порядку фаз (config/turn.ts). Короткий план
 * дополняется ожиданием; действие дороже 1 ОД занимает несколько фаз (rules/plan.ts).
 */
export type Plan = readonly Action[];

/** won — уровень пройден (убиты все монстры или кто-то вышел через дверь); lost — все погибли. */
export type GameStatus = 'playing' | 'won' | 'lost';

/** Что игрок вынес с уровня — понадобится хабу (магазин, сундук). */
export interface Carried {
  readonly coins: number;
  readonly weapon: Item | null;
  readonly backpack: readonly Item[];
}

export interface Door {
  readonly pos: Position;
  readonly open: boolean;
}

/**
 * Модель ходов — одновременная: каждый игрок выбирает план на ход (pendingPlans),
 * когда выбрали все — ход разрешается по фазам и turn увеличивается.
 * Мёртвые акторы удаляются из actors.
 */
export interface GameState {
  readonly map: GameMap;
  readonly actors: Readonly<Record<ActorId, Actor>>;
  readonly items: Readonly<Record<ItemId, GroundItem>>;
  readonly turn: number;
  readonly pendingPlans: Readonly<Record<PlayerId, Plan>>;
  readonly status: GameStatus;
  /** Состояние генератора случайных чисел (см. rng.ts). Вся случайность — только через него. */
  readonly rng: number;
  /** Следующий номер для id новых сущностей (монстров, предметов): id не повторяются. */
  readonly nextId: number;
  /**
   * Память команды: клетки, которые кто-то из игроков уже видел (индекс y * width + x).
   * Что видно прямо сейчас, не хранится — это выводится из позиций (map/fov.ts).
   */
  readonly explored: readonly boolean[];
  /** Дверь-выход: закрытая — стена; открытая — проход, шагнувший в неё игрок покидает уровень. */
  readonly door: Door | null;
  /** Кто покинул уровень и что унёс (через дверь или после победы). */
  readonly escaped: Readonly<Record<PlayerId, Carried>>;
}
