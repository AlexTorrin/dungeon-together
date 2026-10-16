import Phaser from 'phaser';
import {
  createEmptyRoom,
  isInBounds,
  resizeMap,
  serializeRoom,
  setRoomSpawn,
  setTile,
  type Position,
  type Room,
} from '@dt/shared';
import { ANIMATIONS, firstFrame } from '../assetKeys';
import { EDITOR, TILE_SIZE, UI_COLORS } from '../config';
import { MapView, tileCenter } from '../render/mapView';
import { deleteRoom, saveRoom } from '../storage/roomStorage';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES, type EditorDraft, type EditorSceneData, type GameSceneData } from './sceneKeys';

type Tool = 'wall' | 'floor' | 'spawn';

const TOOLS: readonly { tool: Tool; label: string; key: string }[] = [
  { tool: 'wall', label: '1 Стена', key: 'ONE' },
  { tool: 'floor', label: '2 Пол', key: 'TWO' },
  { tool: 'spawn', label: '3 Старт', key: 'THREE' },
];

/** Высота панели инструментов сверху; клики по ней не рисуют на карте. */
const TOOLBAR_HEIGHT = 92;
const MARGIN = 24;

function newDraft(): EditorDraft {
  return {
    id: null,
    name: 'Новая комната',
    room: createEmptyRoom(EDITOR.defaultWidth, EDITOR.defaultHeight),
    dirty: false,
  };
}

const clampSize = (n: number): number => Phaser.Math.Clamp(n, EDITOR.minSize, EDITOR.maxSize);

/**
 * Редактор комнат. Состояние редактора — один объект EditorDraft; любое изменение
 * создаёт новый draft и перерисовывает карту (комнаты маленькие, это дёшево).
 */
export class RoomEditorScene extends Phaser.Scene {
  private draft!: EditorDraft;
  private tool: Tool = 'wall';
  private mapView!: MapView;
  private grid!: Phaser.GameObjects.Graphics;
  private spawnMarker!: Phaser.GameObjects.Sprite;
  private ui!: UiOverlay;
  private toolButtons = new Map<Tool, TextButton>();
  private title!: Phaser.GameObjects.Text;
  private sizeLabel!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENES.editor);
  }

  init(data: EditorSceneData): void {
    this.draft = data.draft ?? newDraft();
    this.toolButtons = new Map();
  }

  create(): void {
    this.ui = new UiOverlay(this);
    this.mapView = new MapView(this, this.draft.room.map, (obj) => this.ui.world(obj));
    this.grid = this.ui.world(this.add.graphics());
    this.spawnMarker = this.ui.world(
      this.add.sprite(0, 0, firstFrame(ANIMATIONS.heroIdle)).setAlpha(0.85),
    );
    this.spawnMarker.play(ANIMATIONS.heroIdle.key);
    this.createToolbar();
    this.bindInput();
    this.refresh();

    const onResize = (): void => this.fitCamera();
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
  }

  // ---------- UI ----------

  private createToolbar(): void {
    const { ui } = this;
    ui.add(this.add.rectangle(0, 0, 4096, TOOLBAR_HEIGHT, UI_COLORS.panel, 0.92).setOrigin(0));

    const tools = TOOLS.map(({ tool, label }) => {
      const button = ui.add(new TextButton(this, 0, 0, label, () => this.selectTool(tool)));
      this.toolButtons.set(tool, button);
      return button;
    });
    const btn = (label: string, onClick: () => void): TextButton =>
      ui.add(new TextButton(this, 0, 0, label, onClick));

    const x = layoutRow(tools, 12, 10) + 18;
    layoutRow(
      [
        btn('Новая', () => this.scene.restart({})),
        btn('Сохранить', () => this.save()),
        btn('Удалить', () => this.remove()),
        btn('ASCII', () => void this.copyAscii()),
        btn('▶ Тест', () => this.test()),
        btn('Меню', () => this.scene.start(SCENES.menu)),
      ],
      x,
      10,
    );

    this.sizeLabel = ui.text(0, 0, '');
    // Фиксированная ширина, чтобы название справа не прыгало при смене размера.
    this.sizeLabel.setPadding(0, 6, 0, 6).setFixedSize(64, 0);
    const sizeEnd = layoutRow(
      [
        btn('Ш−', () => this.resize(-1, 0)),
        btn('Ш+', () => this.resize(1, 0)),
        btn('В−', () => this.resize(0, -1)),
        btn('В+', () => this.resize(0, 1)),
        this.sizeLabel,
      ],
      12,
      50,
    );
    this.title = ui.text(sizeEnd + 18, 56, '');
    ui.text(
      12,
      0,
      'ЛКМ — рисовать · ПКМ — стена · 1/2/3 — инструмент · T — тест · Esc — меню',
      UI_COLORS.muted,
    ).setY(TOOLBAR_HEIGHT + 6);
  }

  private bindInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.paintAt(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.paintAt(p);
    });

    const kb = this.input.keyboard;
    for (const { tool, key } of TOOLS) kb?.on(`keydown-${key}`, () => this.selectTool(tool));
    kb?.on('keydown-T', () => this.test());
    kb?.on('keydown-ESC', () => this.scene.start(SCENES.menu));
  }

  private selectTool(tool: Tool): void {
    this.tool = tool;
    for (const [t, button] of this.toolButtons) button.setSelected(t === tool);
  }

  // ---------- Редактирование ----------

  private paintAt(pointer: Phaser.Input.Pointer): void {
    if (pointer.y < TOOLBAR_HEIGHT) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const pos: Position = {
      x: Math.floor(world.x / TILE_SIZE),
      y: Math.floor(world.y / TILE_SIZE),
    };
    const { room } = this.draft;
    if (!isInBounds(room.map, pos)) return;

    const tool: Tool = pointer.rightButtonDown() ? 'wall' : this.tool;
    this.setRoom(this.applyTool(room, pos, tool));
  }

  private applyTool(room: Room, pos: Position, tool: Tool): Room {
    switch (tool) {
      case 'spawn':
        return setRoomSpawn(room, pos);
      case 'floor':
        return { ...room, map: setTile(room.map, pos, 'floor') };
      case 'wall': {
        // Под точкой старта всегда должен быть пол — стену туда не ставим.
        if (pos.x === room.spawn.x && pos.y === room.spawn.y) return room;
        return { ...room, map: setTile(room.map, pos, 'wall') };
      }
    }
  }

  private resize(dw: number, dh: number): void {
    const { map, spawn } = this.draft.room;
    const width = clampSize(map.width + dw);
    const height = clampSize(map.height + dh);
    if (width === map.width && height === map.height) return;

    const resized: Room = { map: resizeMap(map, width, height), spawn };
    const clamped = { x: Math.min(spawn.x, width - 1), y: Math.min(spawn.y, height - 1) };
    this.setRoom(setRoomSpawn(resized, clamped));
  }

  /** Подменяет комнату в черновике; если ничего не поменялось — ничего не делает. */
  private setRoom(room: Room): void {
    if (room === this.draft.room) return;
    this.draft = { ...this.draft, room, dirty: true };
    this.refresh();
  }

  // ---------- Действия ----------

  private save(): void {
    let { name } = this.draft;
    if (this.draft.id === null) {
      const input = window.prompt('Название комнаты', name);
      if (input === null) return;
      name = input.trim() || name;
    }
    const id = saveRoom(this.draft.id, name, this.draft.room);
    this.draft = { ...this.draft, id, name, dirty: false };
    this.refresh();
    this.ui.toast(`Сохранено: ${name}`);
  }

  private remove(): void {
    const { id, name } = this.draft;
    if (id === null) {
      this.scene.restart({});
      return;
    }
    if (!window.confirm(`Удалить комнату «${name}»?`)) return;
    deleteRoom(id);
    this.scene.restart({});
  }

  private async copyAscii(): Promise<void> {
    const ascii = serializeRoom(this.draft.room);
    try {
      await navigator.clipboard.writeText(ascii);
      this.ui.toast('ASCII скопирован в буфер обмена');
    } catch {
      console.log(ascii);
      this.ui.toast('Буфер недоступен — ASCII выведен в консоль');
    }
  }

  private test(): void {
    const data: GameSceneData = {
      room: this.draft.room,
      back: { to: 'editor', draft: this.draft },
      playerCount: 1,
    };
    this.scene.start(SCENES.game, data);
  }

  // ---------- Отрисовка ----------

  private refresh(): void {
    const { room, name, dirty } = this.draft;
    this.mapView.setMap(room.map);
    this.spawnMarker.setPosition(...tileCenter(room.spawn));
    this.selectTool(this.tool);
    this.sizeLabel.setText(`${room.map.width}×${room.map.height}`);
    this.title.setText(
      `${name}${dirty ? ' *' : ''}${this.draft.id === null ? ' (не сохранена)' : ''}`,
    );
    this.fitCamera();
  }

  /** Толщина линий задаётся в мировых единицах, поэтому делим на зум — на экране всегда 1px. */
  private drawGrid(zoom: number): void {
    const { width, height } = this.draft.room.map;
    const g = this.grid.clear().lineStyle(1 / zoom, 0xffffff, 0.15);
    for (let x = 0; x <= width; x++)
      g.lineBetween(x * TILE_SIZE, 0, x * TILE_SIZE, height * TILE_SIZE);
    for (let y = 0; y <= height; y++)
      g.lineBetween(0, y * TILE_SIZE, width * TILE_SIZE, y * TILE_SIZE);
    g.lineStyle(2 / zoom, 0xffd27f, 0.6).strokeRect(0, 0, width * TILE_SIZE, height * TILE_SIZE);
  }

  /** Вписывает карту в область под панелью: целочисленный зум, чтобы пиксели оставались ровными. */
  private fitCamera(): void {
    const { width, height } = this.draft.room.map;
    const areaW = this.scale.width - MARGIN * 2;
    const areaH = this.scale.height - TOOLBAR_HEIGHT - MARGIN * 2 - 20;
    const zoom = Math.max(
      1,
      Math.floor(Math.min(areaW / (width * TILE_SIZE), areaH / (height * TILE_SIZE))),
    );
    const camera = this.cameras.main.setZoom(zoom);
    // Сдвигаем центр вниз на половину панели, чтобы карта была по центру свободной области.
    const offsetY = (TOOLBAR_HEIGHT + 20) / 2 / zoom;
    camera.centerOn((width * TILE_SIZE) / 2, (height * TILE_SIZE) / 2 - offsetY);
    this.drawGrid(zoom);
  }
}
