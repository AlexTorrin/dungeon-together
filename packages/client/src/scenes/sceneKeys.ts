import type { Room } from '@dt/shared';

export const SCENES = {
  boot: 'boot',
  menu: 'menu',
  game: 'game',
  editor: 'editor',
} as const;

/** Комната, открытая в редакторе (id === null — ещё не сохранена). */
export interface EditorDraft {
  readonly id: string | null;
  readonly name: string;
  readonly room: Room;
  readonly dirty: boolean;
}

export interface EditorSceneData {
  readonly draft?: EditorDraft;
}

/** Куда вернуться из игры по Esc. */
export type GameReturn =
  { readonly to: 'menu' } | { readonly to: 'editor'; readonly draft: EditorDraft };

/** 1 — обычная игра, 2 — hot-seat: два игрока за одной клавиатурой. */
export type LocalPlayerCount = 1 | 2;

export interface GameSceneData {
  readonly room: Room;
  readonly back: GameReturn;
  readonly playerCount: LocalPlayerCount;
}
