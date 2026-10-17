import type { Loadout, Room } from '@dt/shared';

export const SCENES = {
  boot: 'boot',
  menu: 'menu',
  game: 'game',
  editor: 'editor',
  hub: 'hub',
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

export interface GameSceneData {
  readonly room: Room;
  /** Что за уровень — для HUD: «Подземелье #seed», название комнаты. */
  readonly title: string;
  readonly back: GameReturn;
  /**
   * Забег из лагеря: с чем герой пришёл (уже убрано из профиля). Добыча после выхода
   * вернётся в профиль. Нет — тренировка (демо, свои комнаты, редактор): профиль не трогаем.
   */
  readonly run?: Loadout;
}
