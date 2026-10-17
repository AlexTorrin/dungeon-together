import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import {
  DIFFICULTY_LIST,
  MAX_PLAYERS,
  parseRoomCode,
  startRun,
  type Difficulty,
  type JoinOptions,
} from '@dt/shared';
import { UI_COLORS } from '../config';
import { Lobby } from '../net/Lobby';
import { connectionError, createRoom, joinRoom } from '../net/connection';
import { loadPlayerName, savePlayerName } from '../storage/playerName';
import { loadProfile, saveProfile } from '../storage/profileStorage';
import { WEAPON_NAMES } from '../ui/names';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES, type GameSceneData } from './sceneKeys';

const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = {
  easy: 'легко',
  medium: 'средне',
  hard: 'трудно',
};

export interface LobbySceneData {
  /** Уже подключены (сцена перерисовывается через restart). */
  readonly lobby?: Lobby;
}

/**
 * Сетевая игра до старта: создать комнату или войти по коду, увидеть, кто собрался;
 * хост начинает забег. Само подключение живёт в Lobby, сцена только рисует.
 */
export class LobbyScene extends Phaser.Scene {
  private ui!: UiOverlay;
  private lobby: Lobby | null = null;
  private connecting = false;

  constructor() {
    super(SCENES.lobby);
  }

  init(data: LobbySceneData): void {
    this.lobby = data.lobby ?? null;
    this.connecting = false;
  }

  create(): void {
    this.ui = new UiOverlay(this);
    this.cameras.main.setBackgroundColor(UI_COLORS.panel);
    const { width, height } = this.scale;
    const left = Math.max(24, width / 2 - 260);
    let y = Math.max(24, height / 2 - 220);
    this.ui.add(
      this.add.text(left, y, 'Сетевая игра', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: UI_COLORS.text,
      }),
    );
    y += 56;

    const lobby = this.lobby;
    if (lobby) {
      lobby.onChange = () => this.onLobbyChange(lobby);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => (lobby.onChange = null));
      // Пока сцена перезапускалась, забег мог начаться или связь — пропасть.
      if (lobby.started || lobby.lost) {
        this.onLobbyChange(lobby);
        return;
      }
      this.drawRoom(lobby, left, y);
    } else {
      this.drawConnect(left, y);
    }

    this.input.keyboard?.on('keydown-ESC', () => this.goBack());
    const onResize = (): void => this.redraw();
    this.scale.once('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
  }

  // ---------- До подключения ----------

  private drawConnect(left: number, y: number): void {
    const name = loadPlayerName() ?? 'Игрок';
    const profile = loadProfile();
    const nameLabel = this.ui.text(0, 0, `Имя: ${name}`);
    nameLabel.setPadding(0, 6, 0, 6);
    const rename = this.ui.add(new TextButton(this, 0, 0, 'изменить', () => this.askName()));
    layoutRow([nameLabel, rename], left, y);
    y += 40;
    const backpack = profile.backpack.map((t) => WEAPON_NAMES[t]).join(', ') || 'пусто';
    this.ui.text(
      left,
      y,
      `С собой: в руках ${WEAPON_NAMES[profile.hands ?? 'none']} · рюкзак: ${backpack}` +
        '\n(снаряжение — в лагере; уйдёт из профиля, когда хост начнёт забег)',
      UI_COLORS.muted,
    );
    y += 56;

    this.ui.text(left, y, 'Создать комнату:', UI_COLORS.muted);
    y += 24;
    const create = DIFFICULTY_LIST.map((difficulty) =>
      this.ui.add(
        new TextButton(this, 0, 0, `▶ ${DIFFICULTY_NAMES[difficulty]}`, () =>
          this.connect(() => createRoom({ difficulty, ...this.joinOptions() })),
        ),
      ),
    );
    layoutRow(create, left, y);
    y += 52;
    const join = this.ui.add(new TextButton(this, 0, 0, 'Войти по коду', () => this.askCode()));
    const back = this.ui.add(new TextButton(this, 0, 0, '← в меню (Esc)', () => this.goBack()));
    layoutRow([join, back], left, y);
  }

  /** Снаряжение показываем серверу, но из профиля уберём только при старте забега. */
  private joinOptions(): JoinOptions {
    const profile = loadProfile();
    return {
      name: loadPlayerName() ?? 'Игрок',
      loadout: { weapon: profile.hands, backpack: profile.backpack },
    };
  }

  private askName(): void {
    const name = window.prompt('Как вас зовут?', loadPlayerName() ?? '');
    if (name === null) return;
    savePlayerName(name);
    this.redraw();
  }

  private askCode(): void {
    const raw = window.prompt('Код комнаты (4 буквы):');
    if (raw === null) return;
    const code = parseRoomCode(raw);
    if (!code) {
      this.ui.toast('Код — 4 латинские буквы, например KQXT');
      return;
    }
    this.connect(() => joinRoom(code, this.joinOptions()));
  }

  private connect(open: () => Promise<Room>): void {
    if (this.connecting) return;
    this.connecting = true;
    this.ui.toast('Подключаемся…');
    open()
      .then((room) => {
        if (!this.scene.isActive()) {
          void room.leave();
          return;
        }
        this.lobby = new Lobby(room);
        this.redraw();
      })
      .catch((error: unknown) => {
        this.connecting = false;
        console.warn('Подключение не удалось', error);
        if (this.scene.isActive()) this.ui.toast(connectionError(error));
      });
  }

  // ---------- В комнате ----------

  private drawRoom(lobby: Lobby, left: number, y: number): void {
    const info = lobby.info;
    if (!info) {
      this.ui.text(left, y, 'Входим в комнату…', UI_COLORS.muted);
      return;
    }
    this.ui.text(left, y, 'Код комнаты — скажите его друзьям:', UI_COLORS.muted);
    y += 22;
    this.ui.add(
      this.add.text(left, y, info.code, {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: UI_COLORS.text,
      }),
    );
    y += 56;
    this.ui.text(left, y, `Сложность: ${DIFFICULTY_NAMES[info.difficulty]}`, UI_COLORS.muted);
    y += 30;
    this.ui.text(left, y, `Игроки (${info.players.length}/${MAX_PLAYERS}):`, UI_COLORS.muted);
    y += 24;
    for (const player of info.players) {
      const marks = [
        player.playerId === info.host ? 'хост' : '',
        player.playerId === info.you ? 'вы' : '',
      ].filter(Boolean);
      this.ui.text(left + 12, y, `${player.name}${marks.length ? ` (${marks.join(', ')})` : ''}`);
      y += 24;
    }
    y += 16;
    const leave = this.ui.add(new TextButton(this, 0, 0, 'Выйти (Esc)', () => this.goBack()));
    if (info.host === info.you) {
      const start = this.ui.add(new TextButton(this, 0, 0, '▶ Начать', () => lobby.start()));
      layoutRow([start, leave], left, y);
    } else {
      layoutRow([leave], left, y);
      this.ui.text(left, y + 44, 'Ждём, пока хост начнёт…', UI_COLORS.muted);
    }
  }

  private onLobbyChange(lobby: Lobby): void {
    if (lobby.lost) {
      this.lobby = null;
      this.redraw();
      this.ui.toast('Связь с комнатой потеряна');
      return;
    }
    const started = lobby.started;
    const info = lobby.info;
    if (!started || !info) {
      this.redraw();
      return;
    }
    // Забег начался: снаряжение уходит из профиля (то же, что мы показали серверу).
    saveProfile(startRun(loadProfile()).profile);
    const names = Object.fromEntries(info.players.map((p) => [p.playerId, p.name]));
    const data: GameSceneData = {
      title: started.title,
      back: { to: 'menu' },
      net: { session: started.session, playerId: info.you, names },
    };
    this.lobby = null; // комната теперь у GameScene — при уходе отсюда не выходить из неё
    this.scene.start(SCENES.game, data);
  }

  private redraw(): void {
    const data: LobbySceneData = this.lobby ? { lobby: this.lobby } : {};
    this.scene.restart(data);
  }

  private goBack(): void {
    this.lobby?.leave();
    this.lobby = null;
    this.scene.start(SCENES.menu);
  }
}
