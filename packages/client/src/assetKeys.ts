import type { WeaponType } from '@dt/shared';

/** Ключи текстур/анимаций и пути к файлам в assets/. */
export const TEXTURES = {
  tileset: 'tileset',
  characters: 'characters',
} as const;

export const ASSET_PATHS = {
  tileset: 'character and tileset/Dungeon_Tileset.png',
  characters: 'character and tileset/Dungeon_Character_2.png',
  arrowItem: 'items and trap_animation/arrow/Just_arrow.png',
  /** Нарисован для проекта — в паке ножа нет (см. docs/assets.md). */
  knifeItem: 'custom/knife.png',
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

/** Предметы на полу: ближнее — нож (свой спрайт), дальнее — стрела из пака. */
export const ITEM_LOOKS: Readonly<Record<WeaponType, StaticLook>> = {
  melee: { texture: ASSET_PATHS.knifeItem },
  ranged: { texture: ASSET_PATHS.arrowItem },
};
