import type { PlayerId, Room } from '@dt/shared';
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

/** Тренировка (демо, свои комнаты, редактор): уровень считается в браузере, профиль не трогаем. */
export interface LocalGameData extends GameSceneBase {
  readonly room: Room;
}

/**
 * Забег на сервере (в одиночку или с друзьями): снаряжение сервер взял из профиля, туда же
 * вернёт вынесенное.
 */
export interface NetGameData extends GameSceneBase {
  readonly net: {
    readonly session: NetworkGame;
    /** Кто мы — id выдал сервер. */
    readonly playerId: PlayerId;
    /** Имена игроков из лобби — для лога хода. */
    readonly names: Readonly<Record<PlayerId, string>>;
    /** Своя комната: профиль не трогается, как в тренировке в браузере. */
    readonly practice: boolean;
  };
}

export type GameSceneData = LocalGameData | NetGameData;
