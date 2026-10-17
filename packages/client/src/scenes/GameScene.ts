import Phaser from 'phaser';
import {
  ACTION_POINTS,
  BACKPACK_SIZE,
  attackableCells,
  canAttack,
  createGameState,
  isPlanValid,
  simulatePlan,
  WEAPONS,
  UNARMED,
  type Item,
  type PlanSimulation,
  directionTo,
  findPath,
  isInBounds,
  posKey,
  samePos,
  step,
  teamVision,
  type Action,
  type Plan,
  type PlanRejectReason,
  type Actor,
  type Direction,
  type GameEvent,
  type GameMap,
  type GameState,
  type PlayerId,
  type Position,
} from '@dt/shared';
import { ANIMATIONS, lookOf } from '../assetKeys';
import { INTENT_COLORS, TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import type { GameSession } from '../game/GameSession';
import { LocalGame } from '../game/LocalGame';
import { randomSeed } from '../game/randomSeed';
import { initialAim, moveAim, nextAimTarget } from '../input/aim';
import { directionFromKeys } from '../input/keyDirection';
import { ActorLayer } from '../render/ActorLayer';
import { FogLayer } from '../render/FogLayer';
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
  undo: [K.BACKSPACE],
  slots: [K.ONE, K.TWO, K.THREE, K.FOUR],
  dropHands: [K.Q],
  attack: [K.SHIFT],
  aim: [K.F],
  nextTarget: [K.TAB],
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
const HUD_HEIGHT = 124;

const WAIT: Action = { type: 'wait' };
/** Второй клик по той же клетке быстрее этого — двойной клик. */
const DOUBLE_CLICK_MS = 350;

/** События хода, разложенные по фазам: каждая заканчивается phaseResolved. */
function splitByPhase(events: readonly GameEvent[]): GameEvent[][] {
  const batches: GameEvent[][] = [[]];
  for (const event of events) {
    batches.at(-1)?.push(event);
    if (event.type === 'phaseResolved') batches.push([]);
  }
  return batches.filter((batch) => batch.length > 0);
}

const WEAPON_NAMES = {
  none: 'кулаки',
  knife: 'нож',
  bow: 'лук',
  sword: 'меч',
  wand: 'палочка',
} as const;
const SPECIES_NAMES = { skeleton: 'скелет', skull: 'череп', vampire: 'вампир' } as const;

const REJECT_TEXT: Readonly<Record<PlanRejectReason, string>> = {
  gameOver: 'Игра уже закончилась',
  alreadySubmitted: 'План на этот ход уже отправлен',
  invalidPlan: 'Этот план не выполнить — переберите действия',
};

/** Оружие в руках: название и характеристики для HUD. */
function weaponLabel(item: Item | null): string {
  const { damage, range, cost } = item ? WEAPONS[item.type] : UNARMED;
  return `${WEAPON_NAMES[item?.type ?? 'none']} (урон ${damage}, дальн. ${range}, удар ${cost} ОД)`;
}

/**
 * Игровая сцена. Ход локального игрока — план из ACTION_POINTS действий (по одному на фазу),
 * собирается в два этапа (паттерн «черновик → подтверждение»):
 *
 * 1. Выбор (draft): первое выбранное действие — фаза 1, второе — фаза 2, следующие заменяют
 *    последнее; Backspace убирает последнее. Каждое действие выбирается от клетки, куда герой
 *    придёт после предыдущих (expectedPositions). Намерения рисуются полупрозрачными с номером фазы.
 * 2. Подтверждение: Enter (недостающие фазы — ожидание) или пункт во всплывашке, если он
 *    заполнил план. Только тогда план уходит в session, стрелки становятся сплошными, появляется ✓.
 *
 * Черновик — чисто клиентская вещь, shared о нём не знает. Цель мыши (goal) переживает ход:
 * после разрешения следующие шаги к ней сами становятся черновиком — остаётся подтвердить.
 * События хода проигрываются по фазам: сначала анимации фазы 1, потом фазы 2.
 */
export class GameScene extends Phaser.Scene {
  private session!: GameSession;
  private ui!: UiOverlay;
  private back!: GameReturn;
  private title = '';
  private actors!: ActorLayer;
  private items!: ItemLayer;
  private fog!: FogLayer;
  /** Клетки, которые сейчас видит команда (posKey); пересчитывается при каждом новом состоянии. */
  private visible: ReadonlySet<string> = new Set();
  private intents!: IntentLayer;
  private popup!: ActionPopup;
  private status!: Phaser.GameObjects.Text;
  private keys = new Map<number, Phaser.Input.Keyboard.Key>();

  /** Выбрано, но не подтверждено: действия по фазам, 0..ACTION_POINTS. */
  private draft: Action[] = [];
  /** Подтверждено и отправлено в этом ходу (до turnResolved). */
  private sent: Plan | null = null;
  /** Ещё не проигранные фазы пришедших событий. */
  private batches: GameEvent[][] = [];
  /** Что произошло за ход — строка в HUD (кто кого ударил, кто что подобрал). */
  private turnLog: string[] = [];
  private lastLog = '';
  /** Имена акторов и предметов — помним и тех, кто уже погиб или исчез с пола. */
  private names = new Map<string, string>();
  /** Клетка, к которой идём мышью; шаги к ней выбираются сами, ход за ходом. */
  private goal: Position | null = null;
  private hover: Position | null = null;
  /** Последний клик по карте — чтобы распознать двойной (в Phaser такого события нет). */
  private lastClick: { readonly tile: Position; readonly at: number } | null = null;
  /** Курсор прицела с клавиатуры (F); null — прицел выключен. */
  private aim: Position | null = null;
  private gameOver = false;

  constructor() {
    super(SCENES.game);
  }

  init(data: GameSceneData): void {
    this.back = data.back;
    this.title = data.title;
    this.session = new LocalGame(createGameState(data.room, [LOCAL_ID], randomSeed()));
    this.keys = new Map();
    this.draft = [];
    this.sent = null;
    this.batches = [];
    this.turnLog = [];
    this.lastLog = '';
    this.names = new Map();
    this.goal = null;
    this.hover = null;
    this.aim = null;
    this.gameOver = false;
  }

  create(): void {
    const ui = new UiOverlay(this);
    this.ui = ui;
    const { state } = this.session;
    new MapView(this, state.map, (obj) => ui.world(obj));
    this.fog = new FogLayer(this, ui);
    this.items = new ItemLayer(this, ui);
    this.intents = new IntentLayer(this, ui);
    this.actors = new ActorLayer(this, ui, new Map([[LOCAL_ID, LOCAL_LOOK]]), () => this.onIdle());
    this.popup = new ActionPopup(this, ui);
    this.rememberNames(state);
    this.visible = teamVision(state);
    this.fog.draw(state, this.visible);
    this.items.sync(state, this.visible);
    this.actors.sync(state, this.visible);

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
      'Ход — 2 ОД · WASD — шаг · Shift+WASD — удар рядом · F — прицел · Пробел — ждать · ' +
        '1–4 — в руки · Q — выбросить',
      UI_COLORS.muted,
    );
    ui.text(
      12,
      28,
      `Клик — меню действий, двойной клик — сразу ход · Enter — подтвердить · ПКМ/Esc — очистить план · Esc — ${backLabel}`,
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
        if (p.rightButtonDown()) {
          this.clearPlan();
          return;
        }
        const tile = this.tileAt(p);
        const last = this.lastClick;
        const isDouble =
          tile && last && samePos(last.tile, tile) && p.downTime - last.at < DOUBLE_CLICK_MS;
        this.lastClick = isDouble || !tile ? null : { tile, at: p.downTime };
        if (isDouble) this.onTileDoubleClick(tile);
        else this.onTileClick(tile);
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
      const nothingPlanned =
        !this.popup.isOpen && this.draft.length === 0 && !this.aim && !this.sent;
      if (this.gameOver || nothingPlanned) this.goBack();
      else this.clearPlan();
      return;
    }
    if (!this.canChoose()) return;
    if (this.is('undo', code)) {
      this.draft = this.draft.slice(0, -1);
      this.goal = null;
      this.aim = null;
      this.redraw();
      return;
    }
    if (this.is('aim', code)) {
      if (this.aim) {
        this.aim = null; // выйти из прицела; выбранный удар остаётся в плане
        this.redraw();
      } else this.enterAim();
      return;
    }
    if (this.aim && this.onAimKey(code)) return;

    const slotKey = (KEYS.slots as readonly number[]).indexOf(code);
    if (slotKey >= 0) {
      this.chooseItem(slotKey, this.held('attack') ? 'drop' : 'equip');
    } else if (this.is('dropHands', code)) {
      const hands = this.chooser()?.weapon;
      if (hands) this.choose({ type: 'drop', itemId: hands.id }, null);
      else this.ui.toast('В руках ничего нет');
    } else if (this.is('confirm', code)) {
      this.confirm();
    } else if (this.is('wait', code)) {
      this.choose(WAIT, null);
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

  /** 1–4: взять в руки предмет из слота рюкзака; Shift+1–4 — выбросить его. */
  private chooseItem(slot: number, type: 'equip' | 'drop'): void {
    const item = this.chooser()?.backpack[slot];
    if (!item) {
      this.ui.toast(`Слот ${slot + 1} пуст`);
      return;
    }
    this.choose({ type, itemId: item.id }, null);
  }

  // ---------- Прицел с клавиатуры ----------

  private enterAim(): void {
    const me = this.chooser();
    if (!me) return;
    this.popup.hide();
    this.setAim(initialAim(this.session.state, me));
  }

  /** Клавиши в режиме прицела; false — клавиша не про прицел, пусть обработается как обычно. */
  private onAimKey(code: number): boolean {
    const me = this.chooser();
    if (!me || !this.aim) return false;
    if (this.is('attack', code)) return true; // Shift в прицеле ничего не делает
    if (this.is('confirm', code)) {
      this.confirm();
      return true;
    }
    if (this.is('nextTarget', code)) {
      const next = nextAimTarget(this.session.state, me, this.aim);
      if (next) this.setAim(next);
      else this.ui.toast('Некого бить в досягаемости');
      return true;
    }
    // Курсор ходит по одной клетке за нажатие: диагональ — две клавиши по очереди.
    const direction = (['up', 'down', 'left', 'right'] as const).find((d) => this.is(d, code));
    if (direction) {
      this.setAim(moveAim(this.session.state, me, this.aim, direction));
      return true;
    }
    this.aim = null; // Пробел и прочее — выходим из прицела и работаем как обычно
    return false;
  }

  /** Курсор на клетку; если туда можно ударить — удар сразу становится действием текущей фазы. */
  private setAim(pos: Position): void {
    const me = this.chooser();
    const slot = this.slot();
    this.aim = pos;
    const canHit = me && canAttack(this.session.state.map, me, pos);
    this.draft = [
      ...this.draft.slice(0, slot),
      ...(canHit ? [{ type: 'attack', target: pos } as const] : []),
    ];
    this.goal = null;
    this.redraw();
  }

  private chooseDirection(direction: Direction): void {
    const me = this.chooser();
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
    const me = this.chooser();
    if (!tile || !me || !this.canChoose()) return;
    this.aim = null;
    if (!this.session.state.explored[tile.y * this.session.state.map.width + tile.x]) {
      this.ui.toast('Туда ещё не смотрели');
      return;
    }
    const { map } = this.session.state;
    const options: PopupOption[] = [];
    // План и фаза — на момент открытия всплывашки. Предпросмотр при наведении пишет в черновик,
    // но всегда от этой базы: иначе предпросмотр сдвигал бы фазу и удар проверялся бы не с той
    // клетки (план отклонялся — тот самый «зависший крестик»).
    const base = this.draft;
    const baseGoal = this.goal;
    const slot = this.slot();
    const offer = (label: string, actions: readonly Action[], goal: Position | null): void => {
      options.push({
        label,
        onPick: () => {
          this.chooseAt(base, slot, actions, goal);
          if (this.planFull()) this.confirm();
          else this.popup.hide();
        },
        onHover: () => this.chooseAt(base, slot, actions, goal, true),
      });
    };

    if (samePos(tile, me.pos)) {
      offer('Ждать', [WAIT], null);
      for (const item of me.backpack) {
        offer(
          `Взять в руки: ${WEAPON_NAMES[item.type]}`,
          [{ type: 'equip', itemId: item.id }],
          null,
        );
      }
      if (me.weapon) {
        offer(
          `Выбросить: ${WEAPON_NAMES[me.weapon.type]}`,
          [{ type: 'drop', itemId: me.weapon.id }],
          null,
        );
      }
    } else {
      // По клетке с кем-то первым предлагаем удар, по пустой — шаг.
      const occupied = Object.values(this.session.state.actors).some((a) => samePos(a.pos, tile));
      const attack = (): void => {
        if (canAttack(map, me, tile)) offer('Ударить', [{ type: 'attack', target: tile }], null);
      };
      if (occupied) attack();
      // Шаги по пути заполняют оставшиеся фазы хода; если путь длиннее — запоминаем цель.
      const path = findPath(this.knownMap(), me.pos, tile);
      const steps = path ? this.stepsAlong(me.pos, path, ACTION_POINTS - slot) : [];
      if (path && steps.length > 0) {
        const turns = path.length > 1 ? ` (${path.length} шаг.)` : '';
        offer(`Идти${turns}`, steps, path.length > steps.length ? tile : null);
      }
      if (!occupied) attack();
    }
    if (options.length === 0) {
      this.ui.toast('Сюда не дойти и не ударить');
      return;
    }
    options.push({
      label: 'Отмена',
      onPick: () => {
        this.popup.hide();
        this.chooseAt(base, base.length, [], baseGoal, true); // вернуть план как был до клика
      },
      onHover: null,
    });
    options[0]?.onHover?.(); // сразу показать намерение первого пункта
    this.popup.show(tile, options);
  }

  /**
   * Двойной клик — план на весь ход сразу, без всплывашки, и подтверждение:
   * пол — шаги по пути (дальше путь продолжится сам), враг — шаг к нему и удар,
   * своя клетка — ждать.
   */
  private onTileDoubleClick(tile: Position): void {
    const me = this.me();
    if (!me || !this.canChoose()) return;
    this.popup.hide();
    this.aim = null;
    const { map, actors, explored } = this.session.state;
    if (!explored[tile.y * map.width + tile.x]) {
      this.ui.toast('Туда ещё не смотрели');
      return;
    }
    const path = samePos(tile, me.pos) ? [] : findPath(this.knownMap(), me.pos, tile);
    const enemy = Object.values(actors).some(
      (a) => a.kind === 'monster' && samePos(a.pos, tile) && this.visible.has(posKey(tile)),
    );
    let plan: Action[];
    let goal: Position | null = null;
    if (samePos(tile, me.pos)) {
      plan = [WAIT, WAIT];
    } else if (enemy) {
      plan = this.approachAndAttack(me, tile, path);
    } else {
      plan = path ? this.stepsAlong(me.pos, path, ACTION_POINTS) : [];
      if (path && path.length > plan.length) goal = tile;
    }
    if (plan.length === 0) {
      this.ui.toast('Сюда не дойти');
      return;
    }
    this.chooseAt([], 0, plan, goal);
    this.confirm();
  }

  /**
   * План против врага на клетке target — первый подходящий: шаг к нему и удар; два удара
   * (уже рядом); один удар (меч — на весь ход); иначе — шаги навстречу.
   */
  private approachAndAttack(
    me: Actor,
    target: Position,
    path: readonly Position[] | null,
  ): Action[] {
    const { map } = this.session.state;
    const attack: Action = { type: 'attack', target };
    const steps = path ? this.stepsAlong(me.pos, path, ACTION_POINTS) : [];
    const candidates: Action[][] = [
      ...(steps[0] ? [[steps[0], attack]] : []),
      [attack, attack],
      [attack],
    ];
    return candidates.find((plan) => isPlanValid(map, me, plan)) ?? steps;
  }

  // ---------- Черновик и подтверждение ----------

  private canChoose(): boolean {
    return (
      !this.gameOver &&
      !this.sent &&
      !this.actors.busy &&
      this.batches.length === 0 &&
      this.me() !== undefined
    );
  }

  /** План «в уме» для героя (shared/rules/plan.ts): где он будет и что в руках к каждой фазе. */
  private simulate(plan: Plan): PlanSimulation | null {
    const me = this.me();
    return me ? simulatePlan(this.session.state.map, me, plan) : null;
  }

  /** Все ОД плана заняты (меч занимает обе фазы одним действием). */
  private planFull(): boolean {
    return (this.simulate(this.draft)?.used ?? 0) >= ACTION_POINTS;
  }

  /** Какое действие плана задаёт следующий выбор: следующее, а если ОД кончились — последнее. */
  private slot(): number {
    return this.planFull() ? Math.max(0, this.draft.length - 1) : this.draft.length;
  }

  /**
   * Герой «к моменту текущего выбора»: на клетке, куда придёт после выбранных раньше действий,
   * и с тем, что тогда будет в руках и в рюкзаке. От него считаются шаги, удары, прицел, путь.
   */
  private chooser(): Actor | undefined {
    return this.simulate(this.draft.slice(0, this.slot()))?.after ?? this.me();
  }

  /** До count шагов по пути (path — без стартовой клетки). */
  private stepsAlong(from: Position, path: readonly Position[], count: number): Action[] {
    const steps: Action[] = [];
    let pos = from;
    for (const cell of path.slice(0, count)) {
      const direction = directionTo(pos, cell);
      if (!direction) break;
      steps.push({ type: 'move', direction });
      pos = cell;
    }
    return steps;
  }

  /** Записывает действия начиная с текущей фазы (лишнее за пределами ОД отбрасывается). */
  private choose(actions: Action | readonly Action[], goal: Position | null): void {
    const list = Array.isArray(actions) ? actions : [actions as Action];
    this.chooseAt(this.draft, this.slot(), list, goal);
  }

  /**
   * План = база до действия slot + действия, пока хватает ОД (лишние шаги отбрасываются).
   * Если не влезает даже первое (удар мечом после шага) — план не меняется, тост (не в quiet).
   */
  private chooseAt(
    base: readonly Action[],
    slot: number,
    actions: readonly Action[],
    goal: Position | null,
    quiet = false,
  ): void {
    let draft = base.slice(0, slot);
    for (const action of actions) {
      const sim = this.simulate([...draft, action]);
      if (!sim) {
        if (draft.length === slot && actions.length > 0 && !quiet) {
          this.ui.toast('Не хватает очков действия');
        }
        break;
      }
      draft = [...draft, action];
      if (sim.used >= ACTION_POINTS) break;
    }
    if (draft.length > slot || actions.length === 0) {
      this.draft = draft;
      this.goal = goal;
    }
    this.redraw();
  }

  /**
   * Очистить план (ПКМ, Esc): черновик, прицел, всплывашку, цель мыши. Если план уже
   * отправлен, но ход ещё не разрешён — отозвать его (cancelPlan) и выбирать заново.
   */
  private clearPlan(): void {
    this.popup.hide();
    this.aim = null;
    this.draft = [];
    this.goal = null;
    if (this.sent && !this.gameOver) {
      this.session.send({ type: 'cancelPlan', playerId: LOCAL_ID });
      this.sent = null;
    }
    this.redraw();
  }

  private confirm(): void {
    this.popup.hide();
    if (!this.canChoose()) return;
    if (this.draft.length === 0) {
      this.ui.toast(this.aim ? 'Сюда не ударить' : 'Сначала выберите действие');
      return;
    }
    // Та же проверка, что в правилах: отправляем только то, что точно примут.
    const me = this.me();
    if (!me || !isPlanValid(this.session.state.map, me, this.draft)) {
      this.ui.toast(REJECT_TEXT.invalidPlan);
      return;
    }
    this.aim = null;
    this.sent = this.draft;
    this.draft = [];
    // Ответ придёт в onEvents через подписку — не сразу, как и по сети.
    this.session.send({ type: 'submitPlan', playerId: LOCAL_ID, plan: this.sent });
    this.redraw();
  }

  /** После хода: если идём к цели мышью — следующие шаги сами становятся черновиком. */
  private continueToGoal(): void {
    const me = this.me();
    if (!this.goal || !me || this.sent) return;
    const path = samePos(me.pos, this.goal) ? null : findPath(this.knownMap(), me.pos, this.goal);
    const steps = path ? this.stepsAlong(me.pos, path, ACTION_POINTS) : [];
    if (path && steps.length > 0) {
      this.draft = steps;
      if (path.length <= steps.length) this.goal = null;
    } else this.goal = null;
  }

  // ---------- События ----------

  /**
   * Пришли события и новое состояние. Спрайты готовим к новому состоянию, не двигая (prepare),
   * а события проигрываем по фазам: следующая фаза — когда закончились анимации предыдущей.
   */
  private onEvents(events: readonly GameEvent[], next: GameState): void {
    this.rememberNames(next);
    this.visible = teamVision(next);
    this.fog.draw(next, this.visible);
    this.actors.prepare(next, this.visible);
    this.batches.push(...splitByPhase(events));
    if (!this.actors.busy) this.playNextPhase();
  }

  /** Проигрывает следующую фазу; если анимаций в ней нет — сразу следующую. */
  private playNextPhase(): void {
    const batch = this.batches.shift();
    if (!batch) {
      this.onTurnPlayed();
      return;
    }
    for (const event of batch) this.playEvent(event);
    if (this.actors.busy) this.redraw();
    else this.playNextPhase();
  }

  private playEvent(event: GameEvent): void {
    this.actors.play(event);
    switch (event.type) {
      case 'planSubmitted':
        this.actors.setReady(event.playerId, true);
        break;
      case 'planCancelled':
        this.actors.setReady(event.playerId, false);
        break;
      case 'planRejected':
        if (event.playerId === LOCAL_ID) {
          this.sent = null; // план не принят — можно выбирать снова
          this.ui.toast(REJECT_TEXT[event.reason]);
        }
        break;
      case 'turnResolved':
        this.actors.clearReady();
        this.sent = null;
        this.lastLog = this.turnLog.join(' · ');
        this.turnLog = [];
        break;
      case 'damaged':
      case 'died':
      case 'itemPickedUp':
      case 'itemEquipped':
      case 'itemDropped':
        this.logEvent(event);
        break;
      case 'gameOver':
        this.showGameOver(event.status);
        break;
      case 'phaseResolved':
      case 'moved':
      case 'bumped':
      case 'waited':
      case 'attacked':
        break; // анимации — в ActorLayer, спрайты — сверкой
      default: {
        // Новый тип события без обработки — ошибка компиляции, а не молчаливый пропуск.
        const unhandled: never = event;
        throw new Error(`Unhandled event ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Запоминает имена акторов и предметов, чтобы описать событие и после их исчезновения. */
  private rememberNames(state: GameState): void {
    for (const actor of Object.values(state.actors)) {
      this.names.set(actor.id, actor.kind === 'monster' ? SPECIES_NAMES[actor.species] : 'игрок');
      for (const item of [...(actor.weapon ? [actor.weapon] : []), ...actor.backpack]) {
        this.names.set(item.id, WEAPON_NAMES[item.type]);
      }
    }
    for (const item of Object.values(state.items)) this.names.set(item.id, WEAPON_NAMES[item.type]);
    this.names.set(LOCAL_ID, 'вы');
  }

  /** Строка лога хода — только про героя и тех, кого видно. */
  private logEvent(event: GameEvent): void {
    const name = (id: string): string => this.names.get(id) ?? '?';
    const seen = (id: string): boolean =>
      id === LOCAL_ID || this.actors.spriteOf(id)?.visible === true;
    switch (event.type) {
      case 'damaged':
        if (event.by === LOCAL_ID)
          this.turnLog.push(`вы попали: ${name(event.actorId)} −${event.amount}`);
        else if (event.actorId === LOCAL_ID)
          this.turnLog.push(`${name(event.by)} попал по вам −${event.amount}`);
        return;
      case 'died':
        if (seen(event.actorId))
          this.turnLog.push(
            event.actorId === LOCAL_ID ? 'вы погибли' : `${name(event.actorId)} убит`,
          );
        return;
      case 'itemPickedUp':
        if (seen(event.actorId)) {
          const who =
            event.actorId === LOCAL_ID ? 'вы подобрали' : `${name(event.actorId)} подобрал`;
          this.turnLog.push(`${who}: ${name(event.itemId)}`);
        }
        return;
      case 'itemEquipped':
        if (seen(event.actorId)) {
          const who =
            event.actorId === LOCAL_ID ? 'вы взяли в руки' : `${name(event.actorId)} взял в руки`;
          this.turnLog.push(`${who}: ${name(event.itemId)}`);
        }
        return;
      case 'itemDropped':
        if (event.actorId === LOCAL_ID) this.turnLog.push(`вы выбросили: ${name(event.itemId)}`);
        else if (this.visible.has(posKey(event.at)))
          this.turnLog.push(`на полу: ${name(event.itemId)}`);
        return;
      default:
        return;
    }
  }

  /** Анимации текущей фазы закончились (колбэк ActorLayer). */
  private onIdle(): void {
    this.playNextPhase();
  }

  /** Все фазы проиграны: выравниваем спрайты и предметы по состоянию, продолжаем путь мыши. */
  private onTurnPlayed(): void {
    const { state } = this.session;
    this.actors.sync(state, this.visible);
    this.items.sync(state, this.visible);
    this.continueToGoal();
    this.redraw();
  }

  private showGameOver(status: 'won' | 'lost'): void {
    this.gameOver = true;
    this.draft = [];
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

  /**
   * Карта, какой её знает команда: неисследованные клетки считаются стенами. По ней
   * прокладываем путь мыши — иначе путь выдал бы планировку, скрытую туманом.
   */
  private knownMap(): GameMap {
    const { map, explored } = this.session.state;
    return { ...map, tiles: map.tiles.map((tile, i) => (explored[i] ? tile : 'wall')) };
  }

  private me(): Actor | undefined {
    return this.session.state.actors[LOCAL_ID];
  }

  private tileAt(p: Phaser.Input.Pointer): Position | null {
    const tile = { x: Math.floor(p.worldX / TILE_SIZE), y: Math.floor(p.worldY / TILE_SIZE) };
    return isInBounds(this.session.state.map, tile) ? tile : null;
  }

  /** Намерения плана: каждое — с клетки, где актор будет в фазе, когда действие сработает. */
  private planIntents(actor: Actor, plan: Plan, color: number, confirmed: boolean): Intent[] {
    const sim = simulatePlan(this.session.state.map, actor, plan);
    const intents: Intent[] = plan.map((action, i) => {
      const phase = sim?.phaseOf[i] ?? i;
      return {
        from: sim?.before[phase]?.pos ?? actor.pos,
        action,
        color,
        confirmed,
        phase: phase + 1,
      };
    });
    // Путь до цели мыши после последнего шага — чтобы было видно, куда идём дальше.
    const last = intents.at(-1);
    if (last && last.action.type === 'move' && this.goal && actor.id === LOCAL_ID) {
      const end = step(last.from, last.action.direction);
      const rest = findPath(this.knownMap(), end, this.goal);
      if (rest) intents[intents.length - 1] = { ...last, path: rest };
    }
    return intents;
  }

  private redraw(): void {
    const { state } = this.session;
    const me = this.me();
    const playing = this.actors.busy || this.batches.length > 0;
    const intents: Intent[] = [];

    if (me && !playing) {
      const plan = this.sent ?? this.draft;
      intents.push(...this.planIntents(me, plan, INTENT_COLORS.me, this.sent !== null));
      // Подтверждённые планы других игроков видны всем (намерения монстров — нет).
      for (const actor of Object.values(state.actors)) {
        const plan = state.pendingPlans[actor.id];
        if (actor.id === LOCAL_ID || actor.kind !== 'player' || !plan) continue;
        intents.push(...this.planIntents(actor, plan, INTENT_COLORS.ally, true));
      }
    }

    const chooser = this.chooser();
    const choosingAttack =
      this.held('attack') ||
      this.draft[this.slot()]?.type === 'attack' ||
      this.popup.isOpen ||
      !!this.aim;
    const showReach = chooser && !this.sent && !this.gameOver && !playing && choosingAttack;
    this.intents.draw({
      intents,
      hover: this.gameOver ? null : this.hover,
      hoverAttackable: !!chooser && !!this.hover && canAttack(state.map, chooser, this.hover),
      reach: showReach ? attackableCells(state.map, chooser) : [],
      cursor:
        this.aim && chooser
          ? { pos: this.aim, valid: canAttack(state.map, chooser, this.aim) }
          : null,
    });
    this.refreshStatus();
  }

  /** Действие плана словами; оружие — то, что будет в руках в момент действия. */
  private describeAction(action: Action, hands: Item | null): string {
    const name = (id: string): string => this.names.get(id) ?? '?';
    switch (action.type) {
      case 'move':
        return `шаг ${ARROWS[action.direction]}`;
      case 'attack':
        return hands?.type === 'sword'
          ? 'удар мечом (замах)'
          : `удар (${WEAPON_NAMES[hands?.type ?? 'none']})`;
      case 'wait':
        return 'ждать';
      case 'equip':
        return `взять: ${name(action.itemId)}`;
      case 'drop':
        return `выбросить: ${name(action.itemId)}`;
    }
  }

  private describePlan(plan: Plan): string {
    const sim = this.simulate(plan);
    return plan
      .map((a, i) => {
        const phase = sim?.phaseOf[i] ?? i;
        return `${phase + 1}) ${this.describeAction(a, sim?.before[phase]?.weapon ?? null)}`;
      })
      .join('  ');
  }

  private refreshStatus(): void {
    const me = this.me();
    const { turn } = this.session.state;
    if (!me) {
      this.status.setText(`Ход ${turn}`);
      return;
    }
    const head = `${this.title} · Ход ${turn} · HP ${me.hp}/${me.maxHp}`;
    const slots = Array.from({ length: BACKPACK_SIZE }, (_, i) => {
      const item = me.backpack[i];
      return `${i + 1}) ${item ? WEAPON_NAMES[item.type] : '—'}`;
    }).join(' ');
    const inventory = `Руки: ${weaponLabel(me.weapon)} · Рюкзак: ${slots}`;
    const used = this.simulate(this.draft)?.used ?? 0;
    const choice = this.sent
      ? `План: ${this.describePlan(this.sent)} ✓ — ждём остальных`
      : this.aim
        ? `Прицел: WASD — двигать, Tab — следующая цель, Enter — ударить, F/Esc — выйти${
            this.draft[this.slot()] ? '' : ' (сюда не ударить)'
          }`
        : this.draft.length === 0
          ? `Выберите действие (ОД: ${ACTION_POINTS})`
          : used < ACTION_POINTS
            ? `План: ${this.describePlan(this.draft)} — ещё ${ACTION_POINTS - used} ОД или Enter (остаток — ждать)`
            : `План: ${this.describePlan(this.draft)} — Enter, чтобы подтвердить`;
    this.status.setText(`${head}\n${inventory}\n${choice}\n${this.lastLog}`);
  }

  private goBack(): void {
    if (this.back.to === 'editor') this.scene.start(SCENES.editor, { draft: this.back.draft });
    else this.scene.start(SCENES.menu);
  }
}
