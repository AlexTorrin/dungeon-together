import Phaser from 'phaser';
import {
  createEmptyRoom,
  isInBounds,
  resizeRoom,
  serializeRoom,
  setRoomDoor,
  setRoomEntity,
  setRoomSpawn,
  setRoomTile,
  type Position,
  type Room,
  type RoomEntity,
} from '@dt/shared';
import { ANIMATIONS, ASSET_PATHS, firstFrame, lootLook } from '../assetKeys';
import { monsterLook } from '../render/actorLooks';
import { EDITOR, TILE_SIZE, UI_COLORS } from '../config';
import { MapView, tileCenter } from '../render/mapView';
import { deleteRoom, saveRoom } from '../storage/roomStorage';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES, type EditorDraft, type EditorSceneData, type GameSceneData } from './sceneKeys';

/**
 * Инструмент: тайл, точка старта, дверь-выход или монстр/вещь. «Пол» заодно стирает монстров,
 * вещи и дверь.
 */
type Tool =
  | { readonly kind: 'wall' }
  | { readonly kind: 'floor' }
  | { readonly kind: 'spawn' }
  | { readonly kind: 'door' }
  | { readonly kind: 'entity'; readonly entity: RoomEntity };

/** Им же рисует правая кнопка мыши. Один объект: кнопки инструментов сравниваются по ссылке. */
const WALL: Tool = { kind: 'wall' };

const TOOLS: readonly { tool: Tool; label: string; key: string }[] = [
  { tool: WALL, label: '1 Стена', key: 'ONE' },
  { tool: { kind: 'floor' }, label: '2 Пол', key: 'TWO' },
  { tool: { kind: 'spawn' }, label: '3 Старт', key: 'THREE' },
  {
    tool: { kind: 'entity', entity: { kind: 'monster', species: 'skeleton' } },
    label: '4 Скелет',
    key: 'FOUR',
  },
  {
    tool: { kind: 'entity', entity: { kind: 'monster', species: 'skull' } },
    label: '5 Череп',
    key: 'FIVE',
  },
  {
    tool: { kind: 'entity', entity: { kind: 'monster', species: 'vampire' } },
    label: '6 Вампир',
    key: 'SIX',
  },
  {
    tool: { kind: 'entity', entity: { kind: 'item', item: { kind: 'weapon', type: 'knife' } } },
    label: '7 Нож',
    key: 'SEVEN',
  },
  {
    tool: { kind: 'entity', entity: { kind: 'item', item: { kind: 'weapon', type: 'bow' } } },
    label: '8 Лук',
    key: 'EIGHT',
  },
  {
    tool: { kind: 'entity', entity: { kind: 'item', item: { kind: 'weapon', type: 'sword' } } },
    label: '9 Меч',
    key: 'NINE',
  },
  {
    tool: { kind: 'entity', entity: { kind: 'item', item: { kind: 'weapon', type: 'wand' } } },
    label: '0 Палочка',
    key: 'ZERO',
  },
];

/** Второй ряд — без горячих клавиш: дверь-выход, монета, ключ. */
const EXTRA_TOOLS: readonly { tool: Tool; label: string }[] = [
  { tool: { kind: 'door' }, label: 'Дверь' },
  {
    tool: { kind: 'entity', entity: { kind: 'item', item: { kind: 'coins', amount: 1 } } },
    label: 'Монета',
  },
  { tool: { kind: 'entity', entity: { kind: 'item', item: { kind: 'key' } } }, label: 'Ключ' },
];

/** Высота панели инструментов сверху; клики по ней не рисуют на карте. */
const TOOLBAR_HEIGHT = 132;
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
  private tool: Tool = WALL;
  private mapView!: MapView;
  private grid!: Phaser.GameObjects.Graphics;
  private spawnMarker!: Phaser.GameObjects.Sprite;
  /** Монстры и предметы комнаты; пересоздаются при каждом изменении (комнаты маленькие). */
  private entitySprites: Phaser.GameObjects.GameObject[] = [];
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
    this.entitySprites = [];
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

    const toolButton = ({ tool, label }: { tool: Tool; label: string }): TextButton => {
      const button = ui.add(new TextButton(this, 0, 0, label, () => this.selectTool(tool)));
      this.toolButtons.set(tool, button);
      return button;
    };
    const btn = (label: string, onClick: () => void): TextButton =>
      ui.add(new TextButton(this, 0, 0, label, onClick));

    layoutRow(TOOLS.map(toolButton), 12, 10);
    const x = layoutRow(EXTRA_TOOLS.map(toolButton), 12, 50) + 18;
    const actionsEnd = layoutRow(
      [
        btn('Новая', () => this.scene.restart({})),
        btn('Сохранить', () => this.save()),
        btn('Удалить', () => this.remove()),
        btn('ASCII', () => void this.copyAscii()),
        btn('▶ Тест', () => this.test()),
        btn('Меню', () => this.scene.start(SCENES.menu)),
      ],
      12,
      90,
    );

    this.sizeLabel = ui.text(0, 0, '');
    // Фиксированная ширина, чтобы название справа не прыгало при смене размера.
    this.sizeLabel.setPadding(0, 6, 0, 6).setFixedSize(64, 0);
    layoutRow(
      [
        btn('Ш−', () => this.resize(-1, 0)),
        btn('Ш+', () => this.resize(1, 0)),
        btn('В−', () => this.resize(0, -1)),
        btn('В+', () => this.resize(0, 1)),
        this.sizeLabel,
      ],
      x,
      50,
    );
    this.title = ui.text(actionsEnd + 18, 96, '');
    ui.text(
      12,
      TOOLBAR_HEIGHT + 6,
      'ЛКМ — рисовать · ПКМ — стена · 1–0 — инструмент (Пол стирает монстров, вещи и дверь) · ' +
        'T — тест · Esc — меню',
      UI_COLORS.muted,
    );
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

    const tool: Tool = pointer.rightButtonDown() ? WALL : this.tool;
    this.setRoom(this.applyTool(room, pos, tool));
  }

  private applyTool(room: Room, pos: Position, tool: Tool): Room {
    switch (tool.kind) {
      case 'spawn':
        return setRoomSpawn(room, pos);
      case 'floor':
        return setRoomTile(setRoomEntity(room, pos, null), pos, 'floor');
      case 'wall':
        return setRoomTile(room, pos, 'wall'); // на точку старта стену не ставит
      case 'door':
        return setRoomDoor(room, pos);
      case 'entity':
        return setRoomEntity(room, pos, tool.entity);
    }
  }

  private resize(dw: number, dh: number): void {
    const { room } = this.draft;
    const width = clampSize(room.map.width + dw);
    const height = clampSize(room.map.height + dh);
    if (width === room.map.width && height === room.map.height) return;

    this.setRoom(resizeRoom(room, width, height));
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
      title: this.draft.name,
      back: { to: 'editor', draft: this.draft },
    };
    this.scene.start(SCENES.game, data);
  }

  // ---------- Отрисовка ----------

  private refresh(): void {
    const { room, name, dirty } = this.draft;
    this.mapView.setMap(room.map);
    this.spawnMarker.setPosition(...tileCenter(room.spawn));
    this.drawEntities(room);
    this.selectTool(this.tool);
    this.sizeLabel.setText(`${room.map.width}×${room.map.height}`);
    this.title.setText(
      `${name}${dirty ? ' *' : ''}${this.draft.id === null ? ' (не сохранена)' : ''}`,
    );
    this.fitCamera();
  }

  private drawEntities(room: Room): void {
    for (const sprite of this.entitySprites) sprite.destroy();
    this.entitySprites = [
      ...room.monsters.map(({ species, pos }) => {
        const { texture, frame, anim } = monsterLook(species);
        return this.ui.world(this.add.sprite(...tileCenter(pos), texture, frame).play(anim));
      }),
      ...room.items.map((item) => {
        const look = lootLook(item);
        const sprite = this.add.sprite(...tileCenter(item.pos), look.texture, look.frame);
        if (look.anim) sprite.play(look.anim);
        return this.ui.world(sprite);
      }),
      ...(room.door
        ? [this.ui.world(this.add.image(...tileCenter(room.door), ASSET_PATHS.doorClosed))]
        : []),
    ];
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
