import type { Loadout, PlayerId, Room } from '@dt/shared';
import type { NetworkGame } from '../game/NetworkGame';

export const SCENES = {
  boot: 'boot',
  menu: 'menu',
  game: 'game',
  editor: 'editor',
  hub: 'hub',
  lobby: 'lobby',
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

interface GameSceneBase {
  /** Что за уровень — для HUD: «Подземелье #seed», название комнаты. */
  readonly title: string;
  readonly back: GameReturn;
}

/** Одиночная игра: уровень считается прямо в браузере (LocalGame). */
export interface LocalGameData extends GameSceneBase {
  readonly room: Room;
  /**
   * Забег из лагеря: с чем герой пришёл (уже убрано из профиля). Добыча после выхода
   * вернётся в профиль. Нет — тренировка (демо, свои комнаты, редактор): профиль не трогаем.
   */
  readonly run?: Loadout;
}

/** Сетевая игра: уровень на сервере. Это всегда забег — добыча вернётся в профиль. */
export interface NetGameData extends GameSceneBase {
  readonly net: {
    readonly session: NetworkGame;
    /** Кто мы — id выдал сервер. */
    readonly playerId: PlayerId;
    /** Имена игроков из лобби — для лога хода. */
    readonly names: Readonly<Record<PlayerId, string>>;
  };
}

export type GameSceneData = LocalGameData | NetGameData;
