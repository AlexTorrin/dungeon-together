import type { ArmorType, ItemType, Loot, WeaponType } from '@dt/shared';

/** Ключи текстур/анимаций и пути к файлам в assets/. */
export const TEXTURES = {
  tileset: 'tileset',
  characters: 'characters',
  walls: 'walls',
  campfire: 'campfire',
} as const;

export const ASSET_PATHS = {
  tileset: 'character and tileset/Dungeon_Tileset.png',
  characters: 'character and tileset/Dungeon_Character_2.png',
  /** Оружие нарисовано для проекта — в паке его нет (tools/sprites, docs/assets.md). */
  knifeItem: 'custom/knife.png',
  bowItem: 'custom/bow.png',
  swordItem: 'custom/sword.png',
  wandItem: 'custom/wand.png',
  /** Броня — тоже своя (tools/sprites/leather.mjs, mail.mjs). */
  leatherItem: 'custom/leather.png',
  mailItem: 'custom/mail.png',
  /** Дверь-выход: закрытая и открытая (tools/sprites/door.mjs). */
  doorClosed: 'custom/door_closed.png',
  doorOpen: 'custom/door_open.png',
  /** Стены для всех сочетаний соседей, собраны из тайлсета пака (tools/sprites/walls.mjs). */
  walls: 'custom/walls.png',
  /** Летящая стрела лука (из пака; смотрит вниз). */
  arrow: 'items and trap_animation/arrow/Just_arrow.png',
  /** Костёр в лагере: 4 кадра 16×16 в ленту (tools/sprites/campfire.mjs). */
  campfire: 'custom/campfire.png',
  /** Сундук в лагере (из пака). */
  chest: 'items and trap_animation/chest/chest_1.png',
} as const;

export interface FrameAnimation {
  readonly key: string;
  readonly frames: readonly string[];
  readonly frameRate: number;
}

function frames(dir: string, prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${dir}/${prefix}_${i + 1}.png`);
}

export const ANIMATIONS = {
  heroIdle: {
    key: 'hero-idle',
    frames: frames('Character_animation/priests_idle/priest1/v1', 'priest1_v1', 4),
    frameRate: 6,
  },
  /** Чужой игрок (не за этой клавиатурой) — пригодится в сетевой игре. */
  otherPlayerIdle: {
    key: 'other-player-idle',
    frames: frames('Character_animation/priests_idle/priest2/v1', 'priest2_v1', 4),
    frameRate: 6,
  },
  skeletonIdle: {
    key: 'skeleton-idle',
    frames: frames('Character_animation/monsters_idle/skeleton1/v1', 'skeleton_v1', 4),
    frameRate: 6,
  },
  skullIdle: {
    key: 'skull-idle',
    frames: frames('Character_animation/monsters_idle/skull/v1', 'skull_v1', 4),
    frameRate: 6,
  },
  vampireIdle: {
    key: 'vampire-idle',
    frames: frames('Character_animation/monsters_idle/vampire/v1', 'vampire_v1', 4),
    frameRate: 6,
  },
  /** Монета, ключ и баночка лечения (красная) на полу — анимации из пака. */
  coin: {
    key: 'coin',
    frames: frames('items and trap_animation/coin', 'coin', 4),
    frameRate: 6,
  },
  key: {
    key: 'key',
    frames: frames('items and trap_animation/keys', 'keys_1', 4),
    frameRate: 6,
  },
  potion: {
    key: 'potion',
    frames: frames('items and trap_animation/flasks', 'flasks_1', 4),
    frameRate: 6,
  },
  torch: {
    key: 'torch',
    frames: frames('items and trap_animation/torch', 'torch', 4),
    frameRate: 8,
  },
} as const satisfies Record<string, FrameAnimation>;

/** Анимация из кадров спрайт-листа (а не отдельных файлов). */
export interface SheetAnimation {
  readonly key: string;
  readonly texture: string;
  readonly frames: readonly number[];
  readonly frameRate: number;
}

export const SHEET_ANIMATIONS = {
  // Dungeon_Character_2.png: кадры 2 и 3 — персонаж в шляпе с оружием в двух позах.
  ranger: { key: 'ranger-idle', texture: TEXTURES.characters, frames: [2, 3], frameRate: 3 },
  campfire: { key: 'campfire', texture: TEXTURES.campfire, frames: [0, 1, 2, 3], frameRate: 8 },
} as const satisfies Record<string, SheetAnimation>;

/** Как выглядит персонаж: стартовая текстура/кадр и ключ зацикленной анимации. */
export interface Look {
  readonly texture: string;
  readonly frame?: number;
  readonly anim: string;
}

export function lookOf(anim: FrameAnimation | SheetAnimation): Look {
  if ('texture' in anim)
    return { texture: anim.texture, frame: anim.frames[0] ?? 0, anim: anim.key };
  return { texture: firstFrame(anim), anim: anim.key };
}

export function firstFrame(anim: FrameAnimation): string {
  const frame = anim.frames[0];
  if (frame === undefined) throw new Error(`Animation '${anim.key}' has no frames`);
  return frame;
}

/** Неподвижная картинка: текстура и (для спрайт-листа) кадр. */
export interface StaticLook {
  readonly texture: string;
  readonly frame?: number;
}

/** Предметы на полу — свои спрайты (в паке оружия и брони нет). */
export const ITEM_LOOKS: Readonly<Record<WeaponType | ArmorType, StaticLook>> = {
  knife: { texture: ASSET_PATHS.knifeItem },
  bow: { texture: ASSET_PATHS.bowItem },
  sword: { texture: ASSET_PATHS.swordItem },
  wand: { texture: ASSET_PATHS.wandItem },
  leather: { texture: ASSET_PATHS.leatherItem },
  mail: { texture: ASSET_PATHS.mailItem },
};

/** Текстура предмета для иконки в интерфейсе (первый кадр, если вещь анимирована). */
export function itemTexture(type: ItemType): string {
  return type === 'potion' ? firstFrame(ANIMATIONS.potion) : ITEM_LOOKS[type].texture;
}

/** Как выглядит вещь на полу: оружие и броня — свой спрайт, баночка, монеты и ключ — анимация из пака. */
export function lootLook(loot: Loot): StaticLook & { readonly anim?: string } {
  switch (loot.kind) {
    case 'weapon':
    case 'armor':
      return ITEM_LOOKS[loot.type];
    case 'potion':
      return { texture: firstFrame(ANIMATIONS.potion), anim: ANIMATIONS.potion.key };
    case 'coins':
      return { texture: firstFrame(ANIMATIONS.coin), anim: ANIMATIONS.coin.key };
    case 'key':
      return { texture: firstFrame(ANIMATIONS.key), anim: ANIMATIONS.key.key };
  }
}
