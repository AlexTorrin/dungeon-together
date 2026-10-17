import Phaser from 'phaser';
import { DEMO_ROOM, DIFFICULTY_LIST, generateLevel, type Difficulty, type Room } from '@dt/shared';
import { randomSeed } from '../game/randomSeed';
import { TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import { MapView } from '../render/mapView';
import { deleteRoom, loadRooms } from '../storage/roomStorage';
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
    let y = Math.max(24, height / 2 - 180);
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
          this.play(
            generateLevel(seed, difficulty),
            `Подземелье #${seed} · ${DIFFICULTY_NAMES[difficulty]}`,
          );
        }),
      ),
    );
    const demo = ui.add(
      new TextButton(this, 0, 0, 'Демо-комната', () => this.play(DEMO_ROOM, 'Демо-комната')),
    );
    ui.text(left, y - 22, 'Новое подземелье:', UI_COLORS.muted);
    layoutRow([...dungeons, demo], left, y);
    y += 44;
    const editor = ui.add(
      new TextButton(this, 0, 0, '✎ Редактор комнат', () => this.openEditor({})),
    );
    layoutRow([editor], left, y);
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

  private play(room: Room, title: string): void {
    const data: GameSceneData = { room, title, back: { to: 'menu' } };
    this.scene.start(SCENES.game, data);
  }

  private openEditor(data: EditorSceneData): void {
    this.scene.start(SCENES.editor, data);
  }
}
