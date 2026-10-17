import Phaser from 'phaser';
import {
  attackableCells,
  canAttack,
  createGameState,
  directionTo,
  findPath,
  isInBounds,
  samePos,
  step,
  weaponOf,
  type Action,
  type Actor,
  type Direction,
  type GameEvent,
  type GameState,
  type PlayerId,
  type Position,
} from '@dt/shared';
import { ANIMATIONS, lookOf } from '../assetKeys';
import { INTENT_COLORS, TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import type { GameSession } from '../game/GameSession';
import { LocalGame } from '../game/LocalGame';
import { directionFromKeys } from '../input/keyDirection';
import { ActorLayer } from '../render/ActorLayer';
import { IntentLayer, type Intent } from '../render/IntentLayer';
import { ItemLayer } from '../render/ItemLayer';
import { MapView } from '../render/mapView';
import { ActionPopup, type PopupOption } from '../ui/ActionPopup';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES, type GameReturn, type GameSceneData } from './sceneKeys';

/** Игрок за этим компьютером. В сетевой игре id выдаст сервер. */
const LOCAL_ID: PlayerId = 'p1';
const LOCAL_LOOK = lookOf(ANIMATIONS.heroIdle);

const K = Phaser.Input.Keyboard.KeyCodes;
const KEYS = {
  up: [K.W, K.UP],
  down: [K.S, K.DOWN],
  left: [K.A, K.LEFT],
  right: [K.D, K.RIGHT],
  wait: [K.SPACE],
  confirm: [K.ENTER],
  attack: [K.SHIFT],
  back: [K.ESC],
} as const;
type KeyRole = keyof typeof KEYS;

const ARROWS: Readonly<Record<Direction, string>> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  upLeft: '↖',
  upRight: '↗',
  downLeft: '↙',
  downRight: '↘',
};

/** Высота панели подсказок и статуса сверху экрана. */
const HUD_HEIGHT = 88;

const WEAPON_NAMES = { none: 'кулаки', melee: 'ближнее', ranged: 'дальнее' } as const;

/**
 * Seed для новой локальной игры. Случайность берётся здесь, в клиенте: shared детерминирован
 * и получает seed готовым. В сетевой игре seed будет выбирать сервер.
 */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

function describe(action: Action): string {
  switch (action.type) {
    case 'move':
      return `шаг ${ARROWS[action.direction]}`;
    case 'attack':
      return 'удар';
    case 'wait':
      return 'ждать';
  }
}

/**
 * Игровая сцена. Ход локального игрока — в два этапа (паттерн «черновик → подтверждение»):
 *
 * 1. Выбор (draft): клавиши направления, Shift+направление (удар рядом), Пробел (ждать) или
 *    клик мышью. Намерение сразу рисуется на карте полупрозрачным, выбор можно менять.
 * 2. Подтверждение: Enter или пункт во всплывашке. Только тогда действие уходит в session,
 *    стрелка становится сплошной и появляется ✓.
 *
 * Черновик — чисто клиентская вещь, shared о нём не знает. Цель мыши (goal) переживает ход:
 * после разрешения следующий шаг к ней сам становится черновиком — остаётся подтвердить.
 */
export class GameScene extends Phaser.Scene {
  private session!: GameSession;
  private ui!: UiOverlay;
  private back!: GameReturn;
  private actors!: ActorLayer;
  private items!: ItemLayer;
  private intents!: IntentLayer;
  private popup!: ActionPopup;
  private status!: Phaser.GameObjects.Text;
  private keys = new Map<number, Phaser.Input.Keyboard.Key>();

  /** Выбрано, но не подтверждено. */
  private draft: Action | null = null;
  /** Подтверждено и отправлено в этом ходу (до turnResolved). */
  private sent: Action | null = null;
  /** Клетка, к которой идём мышью; шаги к ней выбираются сами, ход за ходом. */
  private goal: Position | null = null;
  private hover: Position | null = null;
  private gameOver = false;

  constructor() {
    super(SCENES.game);
  }

  init(data: GameSceneData): void {
    this.back = data.back;
    this.session = new LocalGame(createGameState(data.room, [LOCAL_ID], randomSeed()));
    this.keys = new Map();
    this.draft = null;
    this.sent = null;
    this.goal = null;
    this.hover = null;
    this.gameOver = false;
  }

  create(): void {
    const ui = new UiOverlay(this);
    this.ui = ui;
    const { state } = this.session;
    new MapView(this, state.map, (obj) => ui.world(obj));
    this.items = new ItemLayer(this, ui);
    this.intents = new IntentLayer(this, ui);
    this.actors = new ActorLayer(this, ui, new Map([[LOCAL_ID, LOCAL_LOOK]]), () => this.onIdle());
    this.popup = new ActionPopup(this, ui);
    this.items.sync(state);
    this.actors.sync(state);

    const { map } = state;
    // Сверху запас на высоту HUD, чтобы верхний ряд карты можно было увидеть из-под панели.
    const hud = HUD_HEIGHT / ZOOM;
    const camera = this.cameras.main
      .setZoom(ZOOM)
      .setBounds(
        -TILE_SIZE,
        -TILE_SIZE - hud,
        (map.width + 2) * TILE_SIZE,
        (map.height + 2) * TILE_SIZE + hud,
      );
    const me = this.actors.spriteOf(LOCAL_ID);
    if (me) camera.startFollow(me, true, 0.15, 0.15);

    const backLabel = this.back.to === 'editor' ? 'в редактор' : 'в меню';
    // Подложка под подсказки и статус, чтобы текст не терялся на фоне карты.
    ui.add(this.add.rectangle(0, 0, 4096, HUD_HEIGHT, UI_COLORS.panel, 0.85).setOrigin(0));
    ui.text(
      12,
      10,
      'WASD/стрелки — шаг (две клавиши — по диагонали) · Shift+направление — удар рядом · ' +
        'Пробел — ждать',
      UI_COLORS.muted,
    );
    ui.text(
      12,
      28,
      `Клик — идти/ударить · Enter — подтвердить · ПКМ/Esc — отмена · Esc — ${backLabel}`,
      UI_COLORS.muted,
    );
    this.status = ui.text(12, 50, '');

    this.registerInput();
    // События приходят асинхронно — в том числе после выхода из сцены, поэтому отписываемся.
    const unsubscribe = this.session.subscribe((events, next) => this.onEvents(events, next));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.redraw();
  }

  override update(): void {
    this.actors.followSprites();
  }

  // ---------- Ввод ----------

  private registerInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input unavailable');
    for (const codes of Object.values(KEYS)) {
      for (const code of codes) if (!this.keys.has(code)) this.keys.set(code, kb.addKey(code));
    }
    kb.on('keydown', (e: KeyboardEvent) => this.onKey(e.keyCode));
    kb.on('keyup', (e: KeyboardEvent) => {
      if (this.is('attack', e.keyCode)) this.redraw();
    });

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const tile = this.tileAt(p);
      if (tile && this.hover && samePos(tile, this.hover)) return;
      this.hover = tile;
      this.redraw();
    });
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: readonly Phaser.GameObjects.GameObject[]) => {
        if (over.length > 0) return; // клик по кнопке всплывашки — её обработает кнопка
        if (p.rightButtonDown()) this.cancel();
        else this.onTileClick(this.tileAt(p));
      },
    );
  }

  private is(role: KeyRole, code: number): boolean {
    return (KEYS[role] as readonly number[]).includes(code);
  }

  private held(role: KeyRole): boolean {
    return KEYS[role].some((code) => this.keys.get(code)?.isDown);
  }

  private onKey(code: number): void {
    if (this.is('back', code)) {
      if (this.gameOver || (!this.popup.isOpen && !this.draft)) this.goBack();
      else this.cancel();
      return;
    }
    if (!this.canChoose()) return;

    if (this.is('confirm', code)) {
      this.confirm();
    } else if (this.is('wait', code)) {
      this.choose({ type: 'wait' }, null);
    } else if (this.is('attack', code)) {
      this.redraw(); // показать досягаемость
    } else {
      const direction = directionFromKeys({
        up: this.held('up'),
        down: this.held('down'),
        left: this.held('left'),
        right: this.held('right'),
      });
      if (direction) this.chooseDirection(direction);
    }
  }

  private chooseDirection(direction: Direction): void {
    const me = this.me();
    if (!me) return;
    if (!this.held('attack')) {
      this.choose({ type: 'move', direction }, null);
      return;
    }
    const target = step(me.pos, direction);
    if (canAttack(this.session.state.map, me, target))
      this.choose({ type: 'attack', target }, null);
    else this.ui.toast('Туда не ударить');
  }

  private onTileClick(tile: Position | null): void {
    const me = this.me();
    if (!tile || !me || !this.canChoose()) return;
    const { map } = this.session.state;
    const options: PopupOption[] = [];
    const offer = (label: string, action: Action, goal: Position | null): void => {
      options.push({
        label,
        onPick: () => {
          this.choose(action, goal);
          this.confirm();
        },
        onHover: () => this.choose(action, goal),
      });
    };

    if (samePos(tile, me.pos)) {
      offer('Ждать', { type: 'wait' }, null);
    } else {
      // По клетке с кем-то первым предлагаем удар, по пустой — шаг.
      const occupied = Object.values(this.session.state.actors).some((a) => samePos(a.pos, tile));
      const attack = (): void => {
        if (canAttack(map, me, tile)) offer('Ударить', { type: 'attack', target: tile }, null);
      };
      if (occupied) attack();
      const path = findPath(map, me.pos, tile);
      const first = path?.[0];
      const direction = first ? directionTo(me.pos, first) : null;
      if (path && direction) {
        const turns = path.length > 1 ? ` (${path.length} ход.)` : '';
        offer(`Идти${turns}`, { type: 'move', direction }, path.length > 1 ? tile : null);
      }
      if (!occupied) attack();
    }
    if (options.length === 0) {
      this.ui.toast('Сюда не дойти и не ударить');
      return;
    }
    options.push({ label: 'Отмена', onPick: () => this.cancel(), onHover: null });
    options[0]?.onHover?.(); // сразу показать намерение первого пункта
    this.popup.show(tile, options);
  }

  // ---------- Черновик и подтверждение ----------

  private canChoose(): boolean {
    return !this.gameOver && !this.sent && !this.actors.busy && this.me() !== undefined;
  }

  private choose(action: Action, goal: Position | null): void {
    this.draft = action;
    this.goal = goal;
    this.redraw();
  }

  private cancel(): void {
    this.popup.hide();
    if (!this.sent) {
      this.draft = null;
      this.goal = null;
    }
    this.redraw();
  }

  private confirm(): void {
    this.popup.hide();
    if (!this.canChoose()) return;
    if (!this.draft) {
      this.ui.toast('Сначала выберите действие');
      return;
    }
    this.sent = this.draft;
    this.draft = null;
    // Ответ придёт в onEvents через подписку — не сразу, как и по сети.
    this.session.send({ type: 'submitAction', playerId: LOCAL_ID, action: this.sent });
    this.redraw();
  }

  /** После хода: если идём к цели мышью — следующий шаг сам становится черновиком. */
  private continueToGoal(): void {
    const me = this.me();
    if (!this.goal || !me || this.sent) return;
    const path = samePos(me.pos, this.goal)
      ? null
      : findPath(this.session.state.map, me.pos, this.goal);
    const first = path?.[0];
    const direction = first ? directionTo(me.pos, first) : null;
    if (direction) this.draft = { type: 'move', direction };
    else this.goal = null;
  }

  // ---------- События ----------

  private onEvents(events: readonly GameEvent[], next: GameState): void {
    for (const event of events) {
      this.actors.play(event);
      switch (event.type) {
        case 'actionSubmitted':
          this.actors.setReady(event.playerId, true);
          break;
        case 'turnResolved':
          this.actors.clearReady();
          this.sent = null;
          break;
        case 'gameOver':
          this.showGameOver(event.status);
          break;
        case 'moved':
        case 'bumped':
        case 'waited':
        case 'attacked':
        case 'damaged':
        case 'died':
        case 'itemPickedUp':
        case 'itemDropped':
          break; // анимации — в ActorLayer, спрайты — сверкой
        default: {
          // Новый тип события без обработки — ошибка компиляции, а не молчаливый пропуск.
          const unhandled: never = event;
          throw new Error(`Unhandled event ${JSON.stringify(unhandled)}`);
        }
      }
    }
    this.actors.sync(next);
    if (!this.actors.busy) this.onIdle();
    else this.redraw();
  }

  /** Все анимации хода закончились. */
  private onIdle(): void {
    this.items.sync(this.session.state);
    this.continueToGoal();
    this.redraw();
  }

  private showGameOver(status: 'won' | 'lost'): void {
    this.gameOver = true;
    this.draft = null;
    this.goal = null;
    this.popup.hide();
    const { width, height } = this.scale;
    const title = status === 'won' ? 'Победа!' : 'Вы погибли';
    this.ui.add(this.add.rectangle(0, 0, width, height, UI_COLORS.panel, 0.6).setOrigin(0));
    this.ui
      .add(
        this.add.text(width / 2, height / 2 - 20, title, {
          fontFamily: 'monospace',
          fontSize: '40px',
          color: UI_COLORS.text,
        }),
      )
      .setOrigin(0.5);
    this.ui.text(width / 2, height / 2 + 30, 'Esc — выйти', UI_COLORS.muted).setOrigin(0.5);
  }

  // ---------- Отрисовка ----------

  private me(): Actor | undefined {
    return this.session.state.actors[LOCAL_ID];
  }

  private tileAt(p: Phaser.Input.Pointer): Position | null {
    const tile = { x: Math.floor(p.worldX / TILE_SIZE), y: Math.floor(p.worldY / TILE_SIZE) };
    return isInBounds(this.session.state.map, tile) ? tile : null;
  }

  private redraw(): void {
    const { state } = this.session;
    const me = this.me();
    const intents: Intent[] = [];

    if (me) {
      const action = this.sent ?? this.draft;
      if (action) {
        // Путь до цели мыши после этого шага — чтобы было видно, куда идём дальше.
        const after = action.type === 'move' ? step(me.pos, action.direction) : null;
        const rest = after && this.goal ? findPath(state.map, after, this.goal) : null;
        intents.push({
          from: me.pos,
          action,
          color: INTENT_COLORS.me,
          confirmed: this.sent !== null,
          ...(rest ? { path: rest } : {}),
        });
      }
    }
    // Подтверждённые действия других игроков видны всем (намерения монстров — нет).
    for (const actor of Object.values(state.actors)) {
      const action = state.pendingActions[actor.id];
      if (actor.id === LOCAL_ID || actor.kind !== 'player' || !action) continue;
      intents.push({ from: actor.pos, action, color: INTENT_COLORS.ally, confirmed: true });
    }

    const choosingAttack =
      this.held('attack') || this.draft?.type === 'attack' || this.popup.isOpen;
    const showReach = me && !this.sent && !this.gameOver && choosingAttack;
    this.intents.draw({
      intents,
      hover: this.gameOver ? null : this.hover,
      hoverAttackable: !!me && !!this.hover && canAttack(state.map, me, this.hover),
      reach: showReach ? attackableCells(state.map, me) : [],
    });
    this.refreshStatus();
  }

  private refreshStatus(): void {
    const me = this.me();
    const { turn } = this.session.state;
    if (!me) {
      this.status.setText(`Ход ${turn}`);
      return;
    }
    const weapon = WEAPON_NAMES[me.weapon?.type ?? 'none'];
    const { range, damage } = weaponOf(me);
    const head = `Ход ${turn} · HP ${me.hp}/${me.maxHp} · Оружие: ${weapon} (урон ${damage}, дальность ${range})`;
    const choice = this.sent
      ? `Выбрано: ${describe(this.sent)} ✓ — ждём остальных`
      : this.draft
        ? `Выбрано: ${describe(this.draft)} — Enter, чтобы подтвердить`
        : 'Выберите действие';
    this.status.setText(`${head}\n${choice}`);
  }

  private goBack(): void {
    if (this.back.to === 'editor') this.scene.start(SCENES.editor, { draft: this.back.draft });
    else this.scene.start(SCENES.menu);
  }
}
