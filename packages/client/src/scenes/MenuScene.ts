import Phaser from 'phaser';
import { DEMO_ROOM, DIFFICULTY_LIST, RECONNECT_SECONDS, type Room } from '@dt/shared';
import { TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import { MapView } from '../render/mapView';
import { Lobby } from '../net/Lobby';
import { connectionError, reconnectRoom } from '../net/connection';
import { fetchProfile, profileErrorText } from '../net/profileApi';
import { forgetRoom, rememberedRoom } from '../net/resume';
import { deleteRoom, loadRooms } from '../storage/roomStorage';
import { DIFFICULTY_NAMES, ITEM_NAMES } from '../ui/names';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import type { HubSceneData } from './HubScene';
import type { LobbySceneData } from './LobbyScene';
import { SCENES, type EditorSceneData, type GameSceneData } from './sceneKeys';

const MAX_LISTED_ROOMS = 8;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super(SCENES.menu);
  }

  create(): void {
    // Фон — демо-подземелье, притушенное полупрозрачной панелью.
    const ui = new UiOverlay(this);
    new MapView(this, DEMO_ROOM.map, (obj) => ui.world(obj));
    const camera = this.cameras.main.setZoom(ZOOM);
    camera.centerOn((DEMO_ROOM.map.width * TILE_SIZE) / 2, (DEMO_ROOM.map.height * TILE_SIZE) / 2);

    const { width, height } = this.scale;
    ui.add(this.add.rectangle(0, 0, width, height, UI_COLORS.panel, 0.7).setOrigin(0));

    const left = Math.max(24, width / 2 - 200);
    let y = Math.max(24, height / 2 - 240);
    ui.add(
      this.add.text(left, y, 'Dungeon Togethere', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: UI_COLORS.text,
      }),
    );
    y += 64;

    // Новое подземелье — случайный уровень выбранной сложности.
    const dungeons = DIFFICULTY_LIST.map((difficulty) =>
      ui.add(
        new TextButton(this, 0, 0, `▶ ${DIFFICULTY_NAMES[difficulty]}`, () => {
          // Забег идёт на сервере (комната на одного): профиль меняет только он.
          const data: LobbySceneData = { solo: difficulty };
          this.scene.start(SCENES.lobby, data);
        }),
      ),
    );
    const demo = ui.add(
      new TextButton(this, 0, 0, 'Демо-комната', () => this.play(DEMO_ROOM, 'Демо-комната')),
    );
    ui.text(left, y - 22, 'Новое подземелье — со снаряжением из лагеря:', UI_COLORS.muted);
    layoutRow(dungeons, left, y);
    y += 40;
    const summary = ui.text(left, y, 'Профиль: загружаем…', UI_COLORS.muted);
    fetchProfile()
      .then((profile) => {
        if (!summary.active) return; // сцену уже покинули
        const backpack = profile.backpack.map((t) => ITEM_NAMES[t]).join(', ') || 'пусто';
        summary.setText(
          `Кошелёк: ${profile.coins} · в руках: ${ITEM_NAMES[profile.hands ?? 'none']} · ` +
            `броня: ${ITEM_NAMES[profile.armor ?? 'noArmor']} · рюкзак: ${backpack}`,
        );
      })
      .catch((error: unknown) => {
        if (summary.active) summary.setText(`Профиль: ${profileErrorText(error)}`);
      });
    y += 28;
    // Данные — всегда явно, даже пустые: без них Phaser отдаёт сцене данные прошлого запуска
    // (старый профиль в лагере, лобби с уже сыгранной игрой).
    const hubData: HubSceneData = {};
    const lobbyData: LobbySceneData = {};
    const hub = ui.add(
      new TextButton(this, 0, 0, '⚒ Лагерь: магазин и сундук', () =>
        this.scene.start(SCENES.hub, hubData),
      ),
    );
    const online = ui.add(
      new TextButton(this, 0, 0, '⚔ Сетевая игра', () => this.scene.start(SCENES.lobby, lobbyData)),
    );
    const resume = rememberedRoom();
    const back = resume
      ? [
          ui.add(
            new TextButton(this, 0, 0, `↩ Вернуться в игру ${resume.code}`, () =>
              this.resume(resume.reconnectionToken, ui),
            ),
          ),
        ]
      : [];
    layoutRow([hub, online, ...back], left, y);
    y += 66;
    ui.text(left, y - 22, 'Тренировка — без снаряжения, добыча не сохраняется:', UI_COLORS.muted);
    const editor = ui.add(
      new TextButton(this, 0, 0, '✎ Редактор комнат', () => this.openEditor({})),
    );
    layoutRow([demo, editor], left, y);
    y += 60;

    const rooms = loadRooms();
    ui.text(
      left,
      y,
      rooms.length ? 'Мои комнаты:' : 'Сохранённых комнат пока нет',
      UI_COLORS.muted,
    );
    y += 28;
    for (const saved of rooms.slice(0, MAX_LISTED_ROOMS)) {
      const label = ui.text(0, 0, saved.name.padEnd(18).slice(0, 18));
      const playBtn = ui.add(
        new TextButton(this, 0, 0, 'Играть', () => this.play(saved.room, saved.name)),
      );
      const editBtn = ui.add(
        new TextButton(this, 0, 0, 'Изменить', () =>
          this.openEditor({
            draft: { id: saved.id, name: saved.name, room: saved.room, dirty: false },
          }),
        ),
      );
      const delBtn = ui.add(
        new TextButton(this, 0, 0, '✕', () => {
          deleteRoom(saved.id);
          this.scene.restart();
        }),
      );
      label.setPadding(0, 6, 0, 6);
      layoutRow([label, playBtn, editBtn, delBtn], left, y);
      y += 36;
    }
    if (rooms.length > MAX_LISTED_ROOMS) {
      ui.text(left, y, `…и ещё ${rooms.length - MAX_LISTED_ROOMS}`, UI_COLORS.muted);
    }

    const onResize = (): void => {
      this.scene.restart();
    };
    this.scale.once('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
  }

  /** После перезагрузки страницы — обратно в комнату, пока сервер держит место. */
  private resume(reconnectionToken: string, ui: UiOverlay): void {
    reconnectRoom(reconnectionToken)
      .then((room) => {
        const data: LobbySceneData = { lobby: new Lobby(room) };
        this.scene.start(SCENES.lobby, data);
      })
      .catch((error: unknown) => {
        console.warn('Вернуться не вышло', error);
        forgetRoom();
        ui.toast(
          /not found|expired|invalid/i.test(String(error))
            ? `Вернуться нельзя: место ждёт ${RECONNECT_SECONDS} с, или игра уже закончилась`
            : connectionError(error),
        );
        this.time.delayedCall(2000, () => this.scene.restart());
      });
  }

  /** Тренировка: уровень считается в браузере, профиль не трогается. */
  private play(room: Room, title: string): void {
    const data: GameSceneData = { room, title, back: { to: 'menu' } };
    this.scene.start(SCENES.game, data);
  }

  private openEditor(data: EditorSceneData): void {
    this.scene.start(SCENES.editor, data);
  }
}
