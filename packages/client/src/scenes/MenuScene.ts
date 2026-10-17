import Phaser from 'phaser';
import {
  DEMO_ROOM,
  DIFFICULTY_LIST,
  generateLevel,
  startRun,
  type Difficulty,
  type Loadout,
  type Room,
} from '@dt/shared';
import { randomSeed } from '../game/randomSeed';
import { TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import { MapView } from '../render/mapView';
import { loadProfile, saveProfile } from '../storage/profileStorage';
import { deleteRoom, loadRooms } from '../storage/roomStorage';
import { WEAPON_NAMES } from '../ui/names';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES, type EditorSceneData, type GameSceneData } from './sceneKeys';

const MAX_LISTED_ROOMS = 8;

const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = {
  easy: 'легко',
  medium: 'средне',
  hard: 'трудно',
};

export class MenuScene extends Phaser.Scene {
  private ui!: UiOverlay;

  constructor() {
    super(SCENES.menu);
  }

  create(): void {
    // Фон — демо-подземелье, притушенное полупрозрачной панелью.
    const ui = (this.ui = new UiOverlay(this));
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
          const seed = randomSeed();
          this.startRun(
            generateLevel(seed, difficulty),
            `Подземелье #${seed} · ${DIFFICULTY_NAMES[difficulty]}`,
          );
        }),
      ),
    );
    const demo = ui.add(
      new TextButton(this, 0, 0, 'Демо-комната', () => this.play(DEMO_ROOM, 'Демо-комната')),
    );
    ui.text(left, y - 22, 'Новое подземелье — со снаряжением из лагеря:', UI_COLORS.muted);
    layoutRow(dungeons, left, y);
    y += 40;
    const profile = loadProfile();
    const backpack = profile.backpack.map((t) => WEAPON_NAMES[t]).join(', ') || 'пусто';
    ui.text(
      left,
      y,
      `Кошелёк: ${profile.coins} · в руках: ${WEAPON_NAMES[profile.hands ?? 'none']} · рюкзак: ${backpack}`,
      UI_COLORS.muted,
    );
    y += 28;
    const hub = ui.add(
      new TextButton(this, 0, 0, '⚒ Лагерь: магазин и сундук', () => this.scene.start(SCENES.hub)),
    );
    layoutRow([hub], left, y);
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

  private play(room: Room, title: string, run?: Loadout): void {
    const data: GameSceneData = { room, title, back: { to: 'menu' }, ...(run ? { run } : {}) };
    this.scene.start(SCENES.game, data);
  }

  /** Забег: снаряжение уходит из профиля сразу — вернётся только то, что вынесете. */
  private startRun(room: Room, title: string): void {
    const { profile, loadout } = startRun(loadProfile());
    if (!saveProfile(profile)) {
      this.ui.toast('Не удалось сохранить профиль — забег не начат');
      return;
    }
    this.play(room, title, loadout);
  }

  private openEditor(data: EditorSceneData): void {
    this.scene.start(SCENES.editor, data);
  }
}
