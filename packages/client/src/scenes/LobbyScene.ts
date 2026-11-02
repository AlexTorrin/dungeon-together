import { t } from '../i18n';
import Phaser from 'phaser';
import type { Room } from '@colyseus/sdk';
import {
  DIFFICULTY_LIST,
  MAX_PLAYERS,
  parseRoomCode,
  serializeRoom,
  type Difficulty,
  type JoinOptions,
} from '@dt/shared';
import { UI_COLORS } from '../config';
import { Lobby } from '../net/Lobby';
import { connectionError, createRoom, joinRoom } from '../net/connection';
import { loadPlayerName, savePlayerName } from '../storage/playerName';
import { playerToken } from '../storage/playerToken';
import { loadRooms } from '../storage/roomStorage';
import { DIFFICULTY_NAMES } from '../ui/names';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES, type GameSceneData } from './sceneKeys';

const MAX_LISTED_ROOMS = 6;
const ROOMS_PER_ROW = 3;

export interface LobbySceneData {
  /** Уже подключены (сцена перерисовывается через restart). */
  readonly lobby?: Lobby;
  /**
   * Одиночный забег из меню: создать комнату этой сложности и сразу начать. Забег — тоже на
   * сервере: профиль меняет только он.
   */
  readonly solo?: Difficulty;
}

/**
 * Сетевая игра до старта: создать комнату или войти по коду, увидеть, кто собрался;
 * хост начинает забег. Само подключение живёт в Lobby, сцена только рисует.
 */
export class LobbyScene extends Phaser.Scene {
  private ui!: UiOverlay;
  private lobby: Lobby | null = null;
  private connecting = false;
  private solo: Difficulty | null = null;

  constructor() {
    super(SCENES.lobby);
  }

  init(data: LobbySceneData): void {
    this.lobby = data.lobby ?? null;
    this.solo = data.solo ?? null;
    this.connecting = false;
  }

  create(): void {
    this.ui = new UiOverlay(this);
    this.cameras.main.setBackgroundColor(UI_COLORS.panel);
    const { width, height } = this.scale;
    const left = Math.max(24, width / 2 - 260);
    let y = Math.max(24, height / 2 - 220);
    this.ui.add(
      this.add.text(left, y, this.solo ? t('lobby.newDungeon') : t('lobby.onlineGame'), {
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
      if (this.solo) this.drawSolo(lobby, left, y);
      else this.drawRoom(lobby, left, y);
    } else if (this.solo) {
      this.ui.text(left, y, t('lobby.preparingDungeon'), UI_COLORS.muted);
      const difficulty = this.solo;
      this.connect(() => createRoom({ difficulty, ...this.joinOptions() }));
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
    const name = loadPlayerName() ?? t('game.player');
    const nameLabel = this.ui.text(0, 0, t('lobby.name', name));
    nameLabel.setPadding(0, 6, 0, 6);
    const rename = this.ui.add(new TextButton(this, 0, 0, t('lobby.change'), () => this.askName()));
    layoutRow([nameLabel, rename], left, y);
    y += 40;
    this.ui.text(left, y, t('lobby.youTakeYourEquippedItemsAnd'), UI_COLORS.muted);
    y += 56;

    this.ui.text(left, y, t('lobby.createARoom'), UI_COLORS.muted);
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
    y = this.drawCustomRooms(left, y);
    const join = this.ui.add(
      new TextButton(this, 0, 0, t('lobby.joinWithCode'), () => this.askCode()),
    );
    const back = this.ui.add(new TextButton(this, 0, 0, t('hub.menuEsc'), () => this.goBack()));
    layoutRow([join, back], left, y);
  }

  /** Свои комнаты из редактора: в сети они — тренировка, как и в одиночку. */
  private drawCustomRooms(left: number, y: number): number {
    const rooms = loadRooms();
    if (rooms.length === 0) return y;
    this.ui.text(left, y, t('lobby.customRoomPracticeNoEquipmentLoot'), UI_COLORS.muted);
    y += 24;
    const buttons = rooms.slice(0, MAX_LISTED_ROOMS).map((saved) =>
      this.ui.add(
        new TextButton(this, 0, 0, saved.name, () =>
          this.connect(() =>
            createRoom({
              custom: { name: saved.name, ascii: serializeRoom(saved.room) },
              ...this.joinOptions(),
            }),
          ),
        ),
      ),
    );
    for (let i = 0; i < buttons.length; i += ROOMS_PER_ROW) {
      layoutRow(buttons.slice(i, i + ROOMS_PER_ROW), left, y);
      y += 40;
    }
    return y + 12;
  }

  /** Токен — по нему сервер найдёт профиль: возьмёт снаряжение и вернёт добычу. */
  private joinOptions(): JoinOptions {
    return { name: loadPlayerName() ?? t('game.player'), token: playerToken() };
  }

  private askName(): void {
    const name = window.prompt(t('lobby.whatIsYourName'), loadPlayerName() ?? '');
    if (name === null) return;
    savePlayerName(name);
    this.redraw();
  }

  private askCode(): void {
    const raw = window.prompt(t('lobby.roomCodeLetters'));
    if (raw === null) return;
    const code = parseRoomCode(raw);
    if (!code) {
      this.ui.toast(t('lobby.enterLatinLettersForExampleKQXT'));
      return;
    }
    this.connect(() => joinRoom(code, this.joinOptions()));
  }

  private connect(open: () => Promise<Room>): void {
    if (this.connecting) return;
    this.connecting = true;
    this.ui.toast(t('lobby.connecting'));
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
        if (!this.scene.isActive()) return;
        if (this.solo) this.showSoloError(connectionError(error));
        else this.ui.toast(connectionError(error));
      });
  }

  // ---------- В комнате ----------

  private drawRoom(lobby: Lobby, left: number, y: number): void {
    const info = lobby.info;
    if (!info) {
      this.ui.text(left, y, t('lobby.joiningRoom'), UI_COLORS.muted);
      return;
    }
    if (lobby.reconnecting) {
      this.ui.text(left + 280, y, t('game.disconnectedReconnecting'), UI_COLORS.text);
    }
    this.ui.text(left, y, t('lobby.roomCodeShareItWithFriends'), UI_COLORS.muted);
    y += 22;
    this.ui.add(
      this.add.text(left, y, info.code, {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: UI_COLORS.text,
      }),
    );
    y += 56;
    const level = info.level;
    this.ui.text(
      left,
      y,
      level.kind === 'custom'
        ? t('lobby.customRoomPracticeNoProfileChanges', level.name)
        : t('lobby.difficulty', DIFFICULTY_NAMES[level.difficulty]),
      UI_COLORS.muted,
    );
    y += 30;
    this.ui.text(left, y, t('lobby.players', info.players.length, MAX_PLAYERS), UI_COLORS.muted);
    y += 24;
    for (const player of info.players) {
      const marks = [
        player.playerId === info.host ? t('lobby.host') : '',
        player.playerId === info.you ? t('game.you') : '',
      ].filter(Boolean);
      this.ui.text(left + 12, y, `${player.name}${marks.length ? ` (${marks.join(', ')})` : ''}`);
      y += 24;
    }
    y += 16;
    const leave = this.ui.add(new TextButton(this, 0, 0, t('lobby.leaveEsc'), () => this.goBack()));
    if (info.host === info.you) {
      const start = this.ui.add(new TextButton(this, 0, 0, t('lobby.start'), () => lobby.start()));
      layoutRow([start, leave], left, y);
    } else {
      layoutRow([leave], left, y);
      this.ui.text(left, y + 44, t('lobby.waitingForTheHostToStart'), UI_COLORS.muted);
    }
  }

  /** Одиночный забег: как только комната готова — начинаем, лобби не показываем. */
  private drawSolo(lobby: Lobby, left: number, y: number): void {
    this.ui.text(left, y, t('lobby.preparingDungeon'), UI_COLORS.muted);
    if (lobby.info) lobby.start();
  }

  private showSoloError(message: string): void {
    const { width, height } = this.scale;
    const left = Math.max(24, width / 2 - 260);
    const y = Math.max(24, height / 2 - 220) + 56;
    this.ui.text(left, y + 28, message);
    const back = this.ui.add(new TextButton(this, 0, 0, t('hub.menuEsc'), () => this.goBack()));
    layoutRow([back], left, y + 64);
  }

  private onLobbyChange(lobby: Lobby): void {
    if (lobby.lost) {
      this.lobby = null;
      if (this.solo) {
        // Не переподключаемся сами — иначе при упавшем сервере крутились бы по кругу.
        this.showSoloError(t('game.connectionToServerLost'));
        return;
      }
      this.redraw();
      this.ui.toast(t('lobby.connectionToRoomLost'));
      return;
    }
    const started = lobby.started;
    const info = lobby.info;
    if (!started || !info) {
      this.redraw();
      return;
    }
    const names = Object.fromEntries(info.players.map((p) => [p.playerId, p.name]));
    const data: GameSceneData = {
      title:
        info.level.kind === 'custom'
          ? t('game.practiceTitle', info.level.name)
          : t('game.dungeonTitle', DIFFICULTY_NAMES[info.level.difficulty]),
      back: { to: 'menu' },
      net: {
        session: started.session,
        playerId: info.you,
        names,
        practice: info.level.kind === 'custom',
      },
    };
    this.lobby = null; // комната теперь у GameScene — при уходе отсюда не выходить из неё
    this.scene.start(SCENES.game, data);
  }

  private redraw(): void {
    const data: LobbySceneData = {
      ...(this.lobby ? { lobby: this.lobby } : {}),
      ...(this.solo ? { solo: this.solo } : {}),
    };
    this.scene.restart(data);
  }

  private goBack(): void {
    this.lobby?.leave();
    this.lobby = null;
    this.scene.start(SCENES.menu);
  }
}
