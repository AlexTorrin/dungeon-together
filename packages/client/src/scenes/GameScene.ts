import { t } from '../i18n';
import Phaser from 'phaser';
import {
  RECONNECT_SECONDS,
  ACTION_POINTS,
  attackableCells,
  canAttack,
  canOpenDoor,
  createGameState,
  isPlanValid,
  simulatePlan,
  ARMORS,
  carriedItems,
  isArmor,
  type GroundItem,
  POTION,
  potionHeal,
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
  type ActorId,
  type Direction,
  type GameEvent,
  type GameMap,
  type GameState,
  type PlayerId,
  type Position,
} from '@dt/shared';
import { ANIMATIONS, lookOf } from '../assetKeys';
import { Sfx } from '../audio/sfx';
import { INTENT_COLORS, MOVE_DURATION_MS, TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import type { GameSession } from '../game/GameSession';
import { LocalGame } from '../game/LocalGame';
import type { NetworkGame } from '../game/NetworkGame';
import { forgetRoom } from '../net/resume';
import { randomSeed } from '../game/randomSeed';
import { initialAim, moveAim, nextAimTarget } from '../input/aim';
import { directionFromKeys } from '../input/keyDirection';
import { ActorLayer } from '../render/ActorLayer';
import { DoorView } from '../render/DoorView';
import { FogLayer } from '../render/FogLayer';
import { IntentLayer, type Intent } from '../render/IntentLayer';
import { ItemLayer } from '../render/ItemLayer';
import { MapView } from '../render/mapView';
import { ActionPopup, type PopupOption } from '../ui/ActionPopup';
import { HUD_BOTTOM, HUD_TOP, Hud } from '../ui/Hud';
import { UiOverlay } from '../ui/UiOverlay';
import { ITEM_NAMES } from '../ui/names';
import { SCENES, type GameReturn, type GameSceneData } from './sceneKeys';

/** Игрок за этим компьютером в одиночной игре. В сетевой id выдаёт сервер. */
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
  openDoor: [K.E],
  attack: [K.SHIFT],
  aim: [K.F],
  nextTarget: [K.TAB],
  help: [K.H],
  mute: [K.M],
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

const WAIT: Action = { type: 'wait' };
/** Второй клик по той же клетке быстрее этого — двойной клик. */
const DOUBLE_CLICK_MS = 350;
/** Тряска камеры, когда бьют вашего героя: длительность и сила (доля размера экрана). */
const HIT_SHAKE = { ms: 120, intensity: 0.004 } as const;
/** Сколько ждать второго Esc, чтобы бросить забег. */
const ABANDON_CONFIRM_MS = 2000;

/** События хода, разложенные по фазам: каждая заканчивается phaseResolved. */
function splitByPhase(events: readonly GameEvent[]): GameEvent[][] {
  const batches: GameEvent[][] = [[]];
  for (const event of events) {
    batches.at(-1)?.push(event);
    if (event.type === 'phaseResolved') batches.push([]);
  }
  return batches.filter((batch) => batch.length > 0);
}

const SPECIES_NAMES = {
  get skeleton() {
    return t('game.skeleton');
  },
  get skull() {
    return t('game.skull');
  },
  get vampire() {
    return t('game.vampire');
  },
} as const;

const REJECT_TEXT: Readonly<Record<PlanRejectReason, string>> = {
  get gameOver() {
    return t('game.theGameHasAlreadyEnded');
  },
  get alreadySubmitted() {
    return t('game.yourPlanForThisTurnHas');
  },
  get invalidPlan() {
    return t('game.thisPlanCannotBeCompletedChoose');
  },
};

/** Вещь на полу словами — для лога. */
function lootName(item: GroundItem): string {
  switch (item.kind) {
    case 'weapon':
    case 'armor':
      return ITEM_NAMES[item.type];
    case 'potion':
      return ITEM_NAMES.potion;
    case 'coins':
      return item.amount === 1 ? t('game.coin') : t('game.coins', item.amount);
    case 'key':
      return t('game.key');
  }
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
  private mapView!: MapView;
  private door!: DoorView;
  /** Клетки, которые сейчас видит команда (posKey); пересчитывается при каждом новом состоянии. */
  private visible: ReadonlySet<string> = new Set();
  private intents!: IntentLayer;
  private popup!: ActionPopup;
  private hud!: Hud;
  private keys = new Map<number, Phaser.Input.Keyboard.Key>();

  /** Выбрано, но не подтверждено: действия по фазам, 0..ACTION_POINTS. */
  private draft: Action[] = [];
  /** Подтверждено и отправлено в этом ходу (до turnResolved). */
  private sent: Plan | null = null;
  /** Ещё не проигранные фазы пришедших событий. */
  private batches: GameEvent[][] = [];
  /** Что произошло за ход — строка в HUD (кто кого ударил, кто что подобрал). */
  private turnLog: { readonly phase: number; readonly text: string }[] = [];
  /** Какая фаза хода сейчас проигрывается — для подписи в логе. */
  private phase = 1;
  private lastLog = '';
  /** Имена акторов и предметов — помним и тех, кто уже погиб или исчез с пола. */
  private names = new Map<string, string>();
  /** Что за вещь лежала на полу (монеты звучат иначе, чем остальное) — после подбора её нет. */
  private lootKinds = new Map<string, GroundItem['kind']>();
  private sfx!: Sfx;
  /** Клетка, к которой идём мышью; шаги к ней выбираются сами, ход за ходом. */
  private goal: Position | null = null;
  private hover: Position | null = null;
  /** Последний клик по карте — чтобы распознать двойной (в Phaser такого события нет). */
  private lastClick: { readonly tile: Position; readonly at: number } | null = null;
  /**
   * План до последнего клика: всплывашка сразу пишет в черновик предпросмотр первого пункта,
   * а двойной клик должен дописывать к тому, что было выбрано до него.
   */
  private beforeClick: { readonly draft: Action[]; readonly goal: Position | null } | null = null;
  /** Курсор прицела с клавиатуры (F); null — прицел выключен. */
  private aim: Position | null = null;
  /** За каким игроком следит камера: свой герой, а без него (погиб, вышел) — союзник. */
  private watching: PlayerId | null = null;
  /** Спрайт, за которым камера следит сейчас, — чтобы не перезапускать слежение каждый ход. */
  private followed: Phaser.GameObjects.Sprite | null = null;
  private gameOver = false;
  /** Забег на сервере (а не тренировка): снаряжение из профиля, бросить — значит потерять. */
  private isRun = false;
  /** Когда Esc в забеге нажали первый раз — второй в течение ABANDON_CONFIRM_MS бросает забег. */
  private abandonAskedAt: number | null = null;
  /** Наш игрок: в одиночной игре LOCAL_ID, в сетевой — что выдал сервер. */
  private myId: PlayerId = LOCAL_ID;
  /** Имена других игроков (сетевая игра). */
  private playerNames: Readonly<Record<PlayerId, string>> = {};
  /** Плашка «связь пропала» (сетевая игра). */
  private offlineBanner: Phaser.GameObjects.Text | null = null;
  /** Сетевая сессия — чтобы выйти из комнаты при уходе со сцены. */
  private net: NetworkGame | null = null;

  constructor() {
    super(SCENES.game);
  }

  init(data: GameSceneData): void {
    this.back = data.back;
    this.title = data.title;
    this.abandonAskedAt = null;
    this.offlineBanner = null;
    if ('net' in data) {
      this.isRun = !data.net.practice;
      this.myId = data.net.playerId;
      this.session = data.net.session;
      this.playerNames = data.net.names;
      this.net = data.net.session;
    } else {
      this.isRun = false;
      this.myId = LOCAL_ID;
      this.session = new LocalGame(createGameState(data.room, [LOCAL_ID], randomSeed()));
      this.playerNames = {};
      this.net = null;
    }
    this.keys = new Map();
    this.draft = [];
    this.sent = null;
    this.batches = [];
    this.turnLog = [];
    this.lastLog = '';
    this.phase = 1;
    this.names = new Map();
    this.lootKinds = new Map();
    this.goal = null;
    this.hover = null;
    this.aim = null;
    this.watching = null;
    this.followed = null;
    this.gameOver = false;
  }

  create(): void {
    const ui = new UiOverlay(this);
    this.ui = ui;
    const { state } = this.session;
    this.mapView = new MapView(this, state.map, (obj) => ui.world(obj));
    this.door = new DoorView(this, ui);
    this.door.sync(state.door);
    this.fog = new FogLayer(this, ui);
    this.items = new ItemLayer(this, ui);
    this.intents = new IntentLayer(this, ui);
    // Имена над героями — когда игроков несколько (одиночный забег тоже идёт через сервер, но
    // подписывать там некого).
    const together = Object.keys(this.playerNames).length > 1;
    const labels = together ? { names: this.playerNames, mine: this.myId } : null;
    const sfx = new Sfx(this.sound);
    this.sfx = sfx;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => sfx.destroy());
    this.actors = new ActorLayer(
      this,
      ui,
      new Map([[this.myId, LOCAL_LOOK]]),
      () => this.onIdle(),
      labels,
      sfx,
    );
    this.popup = new ActionPopup(this, ui);
    this.rememberNames(state);
    this.visible = teamVision(state);
    this.fog.draw(state, this.visible);
    this.items.sync(state, this.visible);
    this.actors.sync(state, this.visible);

    const { map } = state;
    // Запас сверху и снизу на панели HUD, чтобы крайние ряды карты можно было увидеть из-под них.
    const top = HUD_TOP / ZOOM;
    const bottom = HUD_BOTTOM / ZOOM;
    this.cameras.main
      .setZoom(ZOOM)
      .setBounds(
        -TILE_SIZE,
        -TILE_SIZE - top,
        (map.width + 2) * TILE_SIZE,
        (map.height + 2) * TILE_SIZE + top + bottom,
      );
    this.updateCamera();

    const backLabel = this.back.to === 'editor' ? t('game.toEditor') : t('game.toMenu');
    this.hud = new Hud(this, ui, backLabel, (slot) => {
      if (this.canChoose()) this.chooseItem(slot, 'equip');
    });

    this.registerInput();
    // События приходят асинхронно — в том числе после выхода из сцены, поэтому отписываемся.
    const unsubscribe = this.session.subscribe((events, next) => this.onEvents(events, next));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    const net = this.net;
    if (net) {
      // Связь оборвалась окончательно — сервер уже считает, что мы ушли: несённое потеряно.
      net.onDisconnect = () => this.showGameOver('lost', t('game.connectionToServerLost'));
      net.onConnection = (online) => this.setOffline(!online);
      net.onResync = (state) => this.resync(state);
      net.onPlayerStatus = (playerId, online) => {
        const name = this.names.get(playerId) ?? t('game.player');
        this.ui.toast(
          online
            ? t('game.connectionRestored', name)
            : t('game.disconnectedWaitingUpToSBefore', name, RECONNECT_SECONDS),
        );
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        net.onDisconnect = null;
        net.onConnection = null;
        net.onResync = null;
        net.onPlayerStatus = null;
        net.leave();
      });
    }
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
    if (this.is('help', code) || (this.hud.helpOpen && this.is('back', code))) {
      this.hud.toggleHelp();
      return;
    }
    if (this.is('mute', code)) {
      this.ui.toast(this.sfx.toggleMute() ? t('game.soundOffM') : t('game.soundOnM'));
      return;
    }
    if (this.is('back', code)) {
      const nothingPlanned =
        !this.popup.isOpen && this.draft.length === 0 && !this.aim && !this.sent;
      if (this.gameOver) this.goBack();
      else if (nothingPlanned) this.confirmBack();
      else this.clearPlan();
      return;
    }
    if (this.is('nextTarget', code) && !this.me() && !this.gameOver) {
      this.watchNext();
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
    } else if (this.is('openDoor', code)) {
      const me = this.chooser();
      if (me && canOpenDoor(this.session.state, me)) this.choose({ type: 'openDoor' }, null);
      else if (me?.keys) this.ui.toast(t('game.standNextToTheDoor'));
      else if (this.me()?.keys) this.ui.toast(t('game.theKeyIsAlreadyUsedIn'));
      else this.ui.toast(t('game.youNeedAKey'));
    } else if (this.is('dropHands', code)) {
      const hands = this.chooser()?.weapon;
      if (hands) this.choose({ type: 'drop', itemId: hands.id }, null);
      else this.ui.toast(t('game.yourHandsAreEmpty'));
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

  /** 1–4: взять в руки предмет из слота рюкзака (броню — надеть, баночку — выпить); Shift+1–4 — выбросить. */
  private chooseItem(slot: number, type: 'equip' | 'drop'): void {
    const item = this.chooser()?.backpack[slot];
    if (!item) {
      this.ui.toast(t('game.slotIsEmpty', slot + 1));
      return;
    }
    const use = type === 'equip' && item.type === 'potion' ? 'drink' : type;
    this.choose({ type: use, itemId: item.id }, null);
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
      else this.ui.toast(t('game.noTargetsInRange'));
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
    else this.ui.toast(t('game.cannotAttackThere'));
  }

  private onTileClick(tile: Position | null): void {
    this.beforeClick = { draft: this.draft, goal: this.goal };
    const me = this.chooser();
    if (!tile || !me || !this.canChoose()) return;
    this.aim = null;
    if (!this.session.state.explored[tile.y * this.session.state.map.width + tile.x]) {
      this.ui.toast(t('game.thatAreaHasNotBeenExplored'));
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
      offer(t('game.wait'), [WAIT], null);
      if (me.keys > 0) offer(t('game.dropKey'), [{ type: 'dropKey' }], null);
      if (me.coins > 0) {
        offer(t('game.dropCoins', me.coins), [{ type: 'dropCoins', amount: me.coins }], null);
      }
      for (const item of me.backpack) {
        if (item.type === 'potion') {
          const heal = Math.min(potionHeal(me.maxHp), me.maxHp - me.hp);
          offer(
            t('game.drinkPotionAPHP', POTION.cost, heal),
            [{ type: 'drink', itemId: item.id }],
            null,
          );
        } else if (isArmor(item)) {
          offer(
            t('game.wearDamage', ITEM_NAMES[item.type], ARMORS[item.type].defense),
            [{ type: 'equip', itemId: item.id }],
            null,
          );
        } else {
          offer(t('game.equip', ITEM_NAMES[item.type]), [{ type: 'equip', itemId: item.id }], null);
        }
      }
      if (me.weapon) {
        offer(
          t('game.drop', ITEM_NAMES[me.weapon.type]),
          [{ type: 'drop', itemId: me.weapon.id }],
          null,
        );
      }
      if (me.armor) {
        offer(
          t('game.removeAndDrop', ITEM_NAMES[me.armor.type]),
          [{ type: 'drop', itemId: me.armor.id }],
          null,
        );
      }
    } else {
      // Закрытая дверь: открыть, если рядом и есть ключ.
      const { door } = this.session.state;
      if (door && !door.open && samePos(door.pos, tile)) {
        if (canOpenDoor(this.session.state, me))
          offer(t('game.openDoor'), [{ type: 'openDoor' }], null);
        else
          this.ui.toast(me.keys ? t('game.standNextToTheDoor') : t('game.theDoorIsLockedYouNeed'));
      }
      // По клетке с кем-то первым предлагаем удар, по пустой — шаг.
      const occupied = Object.values(this.session.state.actors).some((a) => samePos(a.pos, tile));
      const attack = (): void => {
        if (canAttack(map, me, tile))
          offer(t('game.attack'), [{ type: 'attack', target: tile }], null);
      };
      if (occupied) attack();
      // Шаги по пути заполняют оставшиеся фазы хода; если путь длиннее — запоминаем цель.
      const path = findPath(this.knownMap(), me.pos, tile);
      const steps = path ? this.stepsAlong(me.pos, path, ACTION_POINTS - slot) : [];
      if (path && steps.length > 0) {
        const turns = path.length > 1 ? t('game.steps', path.length) : '';
        offer(t('game.move', turns), steps, path.length > steps.length ? tile : null);
      }
      if (!occupied) attack();
    }
    if (options.length === 0) {
      this.ui.toast(t('game.cannotMoveOrAttackThere'));
      return;
    }
    options.push({
      label: t('game.cancel'),
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
   * Двойной клик — дописать план до конца хода без всплывашки и подтвердить:
   * пол — шаги по пути (дальше путь продолжится сам), враг — шаг к нему и удар,
   * своя клетка — ждать. Выбранное вручную действие (например, «надеть») остаётся первым,
   * а новые считаются от клетки, куда герой придёт после него.
   */
  private onTileDoubleClick(tile: Position): void {
    if (!this.me() || !this.canChoose()) return;
    this.popup.hide();
    this.aim = null;
    if (this.beforeClick) {
      this.draft = this.beforeClick.draft;
      this.goal = this.beforeClick.goal;
      this.beforeClick = null;
    }
    // Дописываем только к неполному плану, набранному вручную; полный план и шаги к прежней
    // цели мыши двойной клик заменяет целиком.
    if (this.goal || this.planFull()) {
      this.draft = [];
      this.goal = null;
    }
    const slot = this.slot();
    const prefix = this.draft.slice(0, slot);
    const me = this.chooser();
    if (!me) return;
    const { map, actors, explored } = this.session.state;
    if (!explored[tile.y * map.width + tile.x]) {
      this.ui.toast(t('game.thatAreaHasNotBeenExplored'));
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
      plan = this.approachAndAttack(me, prefix, tile, path);
    } else {
      const left = ACTION_POINTS - (this.simulate(prefix)?.used ?? 0);
      plan = path ? this.stepsAlong(me.pos, path, left) : [];
      if (path && path.length > plan.length) goal = tile;
    }
    if (plan.length === 0) {
      this.ui.toast(t('game.cannotReachThisTile'));
      this.redraw();
      return;
    }
    this.chooseAt(this.draft, slot, plan, goal);
    this.confirm();
  }

  /**
   * План против врага на клетке target после уже выбранных действий prefix — первый, что
   * проходит правила: шаг к нему и удар; два удара (уже рядом); один удар (меч — на весь ход);
   * шаг; иначе — шаги навстречу. me — герой после prefix (откуда считать путь).
   */
  private approachAndAttack(
    me: Actor,
    prefix: Plan,
    target: Position,
    path: readonly Position[] | null,
  ): Action[] {
    const world = this.session.state;
    const real = this.me();
    const attack: Action = { type: 'attack', target };
    const steps = path ? this.stepsAlong(me.pos, path, ACTION_POINTS) : [];
    const candidates: Action[][] = [
      ...(steps[0] ? [[steps[0], attack]] : []),
      [attack, attack],
      [attack],
      ...(steps[0] ? [[steps[0]]] : []),
    ];
    const fits = (plan: Action[]): boolean =>
      real !== undefined && isPlanValid(world, real, [...prefix, ...plan]);
    return candidates.find(fits) ?? steps;
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
    return me ? simulatePlan(this.session.state, me, plan) : null;
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
          this.ui.toast(t('game.notEnoughActionPoints'));
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
      this.session.send({ type: 'cancelPlan', playerId: this.myId });
      this.sent = null;
    }
    this.redraw();
  }

  private confirm(): void {
    this.popup.hide();
    if (!this.canChoose()) return;
    if (this.draft.length === 0) {
      this.ui.toast(this.aim ? t('game.cannotAttackThisTile') : t('game.chooseAnActionFirst'));
      return;
    }
    // Та же проверка, что в правилах: отправляем только то, что точно примут.
    const me = this.me();
    if (!me || !isPlanValid(this.session.state, me, this.draft)) {
      this.ui.toast(REJECT_TEXT.invalidPlan);
      return;
    }
    this.aim = null;
    this.sent = this.draft;
    this.draft = [];
    // Ответ придёт в onEvents через подписку — не сразу, как и по сети.
    this.session.send({ type: 'submitPlan', playerId: this.myId, plan: this.sent });
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
  /** Связь пропала: показываем плашку; ходить можно, команды уйдут после переподключения. */
  private setOffline(offline: boolean): void {
    this.offlineBanner?.destroy();
    this.offlineBanner = null;
    if (!offline) return;
    const { width } = this.scale;
    this.offlineBanner = this.ui.add(
      this.add
        .text(width / 2, HUD_TOP + 12, t('game.disconnectedReconnecting'), {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: UI_COLORS.text,
          backgroundColor: UI_COLORS.buttonSelected,
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5, 0),
    );
  }

  /**
   * Вернулись после обрыва: события, пришедшие без нас, уже не проиграть — просто встаём в
   * присланное состояние: карта, дверь, туман, акторы, предметы, кто уже отправил план.
   */
  private resync(next: GameState): void {
    this.batches = [];
    this.rememberNames(next);
    this.visible = teamVision(next);
    this.mapView.setMap(next.map);
    this.door.sync(next.door);
    this.fog.draw(next, this.visible);
    this.actors.sync(next, this.visible); // идут анимации — досверит onTurnPlayed
    this.items.sync(next, this.visible);
    this.actors.clearReady();
    for (const id of Object.keys(next.pendingPlans)) this.actors.setReady(id, true);
    this.updateCamera();
    // Наш план либо дошёл до сервера (он в pendingPlans), либо нет — тогда выбираем заново.
    this.sent = Object.hasOwn(next.pendingPlans, this.myId)
      ? (next.pendingPlans[this.myId] ?? null)
      : null;
    if (next.status !== 'playing') this.showGameOver(next.status);
    this.redraw();
  }

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
    // Кто в этой фазе кого-то задел: удар без единого урона — промах («мимо» и запись в лог).
    const hitters = new Set(batch.flatMap((e) => (e.type === 'damaged' ? [e.by] : [])));
    for (const event of batch) {
      this.playEvent(event);
      if (event.type === 'attacked' && !hitters.has(event.actorId))
        this.onMiss(event.actorId, event.target);
    }
    if (this.actors.busy) this.redraw();
    else this.playNextPhase();
  }

  private playEvent(event: GameEvent): void {
    this.actors.play(event);
    this.playSound(event);
    switch (event.type) {
      case 'planSubmitted':
        this.actors.setReady(event.playerId, true);
        break;
      case 'planCancelled':
        this.actors.setReady(event.playerId, false);
        break;
      case 'planRejected':
        if (event.playerId === this.myId) {
          this.sent = null; // план не принят — можно выбирать снова
          this.ui.toast(REJECT_TEXT[event.reason]);
        }
        break;
      case 'turnResolved':
        this.actors.clearReady();
        this.sent = null;
        this.lastLog = this.formatLog();
        this.turnLog = [];
        this.phase = 1;
        break;
      case 'phaseResolved':
        this.phase = event.phase + 1;
        break;
      case 'playerLeft':
        this.actors.setReady(event.playerId, false);
        this.log(t('game.leavingTheGame', this.names.get(event.playerId) ?? t('game.playerLower')));
        this.ui.toast(
          t(
            'game.leavesTheGameTheirItemsRemain',
            this.names.get(event.playerId) ?? t('game.player'),
          ),
        );
        break;
      case 'damaged':
        if (event.actorId === this.myId) this.shakeOnHit();
        this.logEvent(event);
        break;
      case 'died':
      case 'itemPickedUp':
      case 'itemEquipped':
      case 'itemDropped':
        this.logEvent(event);
        break;
      case 'exited':
        this.logEvent(event);
        break;
      case 'doorOpened': {
        // Дверь стала проходом: в карте пол — перерисовать стены вокруг и саму дверь.
        const { state } = this.session;
        this.mapView.setMap(state.map);
        this.door.sync(state.door);
        this.logEvent(event);
        break;
      }
      case 'gameOver':
        this.showGameOver(event.status);
        break;
      case 'drank':
        if (event.actorId === this.myId) this.log(t('game.youDrankAPotionHP', event.healed));
        else if (this.actors.spriteOf(event.actorId)?.visible)
          this.log(t('game.drinksAPotion', this.names.get(event.actorId) ?? '?'));
        break;
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

  /**
   * Звуки событий вне боя (бой и шаги звучат в ActorLayer, вместе с анимациями). Подбор, «надеть»
   * и дверь случаются после шагов фазы — звучат, когда шаг закончился. Чужое — только если видно.
   */
  private playSound(event: GameEvent): void {
    const seen = (id: string): boolean =>
      id === this.myId || this.actors.spriteOf(id)?.visible === true;
    switch (event.type) {
      case 'itemPickedUp':
        if (seen(event.actorId)) {
          const coins = this.lootKinds.get(event.itemId) === 'coins';
          this.sfx.play(coins ? 'coin' : 'pickup', MOVE_DURATION_MS);
        }
        return;
      case 'itemEquipped':
        if (seen(event.actorId)) this.sfx.play('equip', MOVE_DURATION_MS);
        return;
      case 'drank':
        if (seen(event.actorId)) this.sfx.play('drink', MOVE_DURATION_MS);
        return;
      case 'doorOpened':
      case 'exited':
        this.sfx.play('door', MOVE_DURATION_MS);
        return;
      case 'gameOver':
        this.sfx.play(event.status === 'won' ? 'won' : 'lost', MOVE_DURATION_MS);
        return;
      default:
        return;
    }
  }

  /** По вашему герою попали — камера вздрагивает в момент удара. */
  private shakeOnHit(): void {
    this.time.delayedCall(this.actors.hitDelay(this.myId), () =>
      this.cameras.main.shake(HIT_SHAKE.ms, HIT_SHAKE.intensity),
    );
  }

  /** Запоминает имена акторов и предметов, чтобы описать событие и после их исчезновения. */
  private rememberNames(state: GameState): void {
    for (const actor of Object.values(state.actors)) {
      this.names.set(
        actor.id,
        actor.kind === 'monster' ? SPECIES_NAMES[actor.species] : t('game.player2'),
      );
      for (const item of carriedItems(actor)) this.names.set(item.id, ITEM_NAMES[item.type]);
    }
    for (const item of Object.values(state.items)) {
      this.names.set(item.id, lootName(item));
      this.lootKinds.set(item.id, item.kind);
    }
    for (const [id, name] of Object.entries(this.playerNames)) this.names.set(id, name);
    this.names.set(this.myId, t('game.you'));
  }

  /**
   * Строка лога хода — только про героя и тех, кого видно. Про других — в настоящем времени:
   * оно не зависит от рода («Аня погибает», «скелет подбирает»), а имя игрока род не выдаёт.
   */
  private logEvent(event: GameEvent): void {
    const name = (id: string): string => this.names.get(id) ?? '?';
    const seen = (id: string): boolean =>
      id === this.myId || this.actors.spriteOf(id)?.visible === true;
    switch (event.type) {
      case 'damaged':
        if (event.by === this.myId) this.log(t('game.youHit', name(event.actorId), event.amount));
        else if (event.actorId === this.myId)
          this.log(t('game.hitsYou', name(event.by), event.amount));
        return;
      case 'died':
        if (seen(event.actorId))
          this.log(
            event.actorId === this.myId ? t('game.youDied') : t('game.dies', name(event.actorId)),
          );
        return;
      case 'itemPickedUp':
        if (seen(event.actorId)) {
          const who =
            event.actorId === this.myId
              ? t('game.youPickedUp')
              : t('game.picksUp', name(event.actorId));
          this.log(`${who}: ${name(event.itemId)}`);
        }
        return;
      case 'itemEquipped':
        if (seen(event.actorId)) {
          // Броня надевается, оружие берётся в руки.
          const worn = this.session.state.actors[event.actorId]?.armor?.id === event.itemId;
          const who =
            event.actorId === this.myId
              ? t('game.selfAction', worn ? t('game.equippedArmor') : t('game.equippedWeapon'))
              : t(
                  'game.actorAction',
                  name(event.actorId),
                  worn ? t('game.equipsArmor') : t('game.equipsWeapon'),
                );
          this.log(`${who}: ${name(event.itemId)}`);
        }
        return;
      case 'doorOpened':
        this.log(event.actorId === this.myId ? t('game.youOpenedTheDoor') : t('game.doorOpened'));
        return;
      case 'exited':
        this.log(
          event.actorId === this.myId
            ? t('game.youEscapedTheDungeon')
            : t('game.escapesTheDungeon', name(event.actorId)),
        );
        return;
      case 'itemDropped':
        if (event.actorId === this.myId) this.log(t('game.youDropped', name(event.itemId)));
        else if (this.visible.has(posKey(event.at)))
          this.log(t('game.onTheFloor', name(event.itemId)));
        return;
      default:
        return;
    }
  }

  /** Удар никого не задел: «мимо» над клеткой (если её видно) и запись в лог. */
  private onMiss(attackerId: ActorId, target: Position): void {
    if (this.visible.has(posKey(target))) this.actors.floatMiss(target, attackerId);
    if (attackerId === this.myId) this.log(t('game.youMissed'));
    else if (this.actors.spriteOf(attackerId)?.visible) {
      this.log(t('game.missed', this.names.get(attackerId) ?? '?'));
    }
  }

  private log(text: string): void {
    this.turnLog.push({ phase: this.phase, text });
  }

  /** Лог хода по фазам: «ф1: вы — мимо · ф2: вы попали: скелет −3». */
  private formatLog(): string {
    const phases = [...new Set(this.turnLog.map((e) => e.phase))];
    return phases
      .map((p) =>
        t(
          'game.phaseLog',
          p,
          this.turnLog
            .filter((e) => e.phase === p)
            .map((e) => e.text)
            .join(', '),
        ),
      )
      .join(' · ');
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
    this.updateCamera();
    this.continueToGoal();
    this.redraw();
  }

  // ---------- Камера ----------

  /** Живые союзники (другие игроки на уровне) в постоянном порядке — для Tab. */
  private allies(): PlayerId[] {
    return Object.values(this.session.state.actors)
      .filter((a) => a.kind === 'player' && a.id !== this.myId)
      .map((a) => a.id)
      .sort();
  }

  /**
   * Камера следит за своим героем; погиб или вышел дверью — за союзником, пока уровень идёт:
   * за выбранным по Tab, а если его уже нет — за первым живым.
   */
  private updateCamera(): void {
    const { actors } = this.session.state;
    if (actors[this.myId]) this.watching = this.myId;
    else if (!this.watching || !actors[this.watching]) this.watching = this.allies()[0] ?? null;
    const sprite = this.watching ? this.actors.spriteOf(this.watching) : undefined;
    if (!sprite || sprite === this.followed) return;
    this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
    this.followed = sprite;
  }

  /** Tab без своего героя: следить за следующим союзником. */
  private watchNext(): void {
    const allies = this.allies();
    if (allies.length === 0) return;
    const index = allies.indexOf(this.watching ?? '');
    this.watching = allies[(index + 1) % allies.length] ?? null;
    this.updateCamera();
    this.redraw();
  }

  /** Строка выбора, когда своего героя на уровне нет: за кем смотрим и как переключиться. */
  private spectatorLine(): string {
    const target = this.watching ? this.session.state.actors[this.watching] : undefined;
    if (!target) return t('game.waitingForTheLevelToEnd');
    const name = this.names.get(target.id) ?? t('game.ally');
    const next = this.allies().length > 1 ? t('game.tabNextAlly') : '';
    return t('game.watchingEscLeave', name, next);
  }

  private showGameOver(status: 'won' | 'lost', reason?: string): void {
    if (this.gameOver) return;
    this.gameOver = true;
    if (this.net) forgetRoom(); // возвращаться после перезагрузки уже некуда
    this.draft = [];
    this.goal = null;
    this.popup.hide();
    const { width, height } = this.scale;
    const loot = this.session.state.escaped[this.myId];
    const title =
      reason ??
      (status === 'lost'
        ? t('game.youDied2')
        : loot
          ? t('game.levelComplete')
          : t('game.yourTeamCompletedTheLevel'));
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
    const summary = loot
      ? t('game.escapedWithCoinsHands', loot.coins, ITEM_NAMES[loot.weapon?.type ?? 'none']) +
        t('game.armor', ITEM_NAMES[loot.armor?.type ?? 'noArmor']) +
        t(
          'game.backpack',
          loot.backpack.map((i) => ITEM_NAMES[i.type]).join(', ') || t('hub.empty'),
        )
      : t('game.everythingYouCarriedHasBeenLost');
    // Тренировка (демо и свои комнаты): ничего не теряется и не выносится.
    const practice = t('game.practiceEquipmentAndLootAreNot');
    this.ui.text(width / 2, height / 2 + 26, this.isRun ? summary : practice).setOrigin(0.5);
    if (this.isRun && loot) {
      // Сервер вернул вынесенное в профиль в тот же момент, как мы вышли.
      this.ui
        .text(width / 2, height / 2 + 78, t('game.yourLootIsInCamp'), UI_COLORS.muted)
        .setOrigin(0.5);
    }
    this.ui.text(width / 2, height / 2 + 52, t('game.escLeave'), UI_COLORS.muted).setOrigin(0.5);
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
    return this.session.state.actors[this.myId];
  }

  private tileAt(p: Phaser.Input.Pointer): Position | null {
    const tile = { x: Math.floor(p.worldX / TILE_SIZE), y: Math.floor(p.worldY / TILE_SIZE) };
    return isInBounds(this.session.state.map, tile) ? tile : null;
  }

  /** Намерения плана: каждое — с клетки, где актор будет в фазе, когда действие сработает. */
  private planIntents(actor: Actor, plan: Plan, color: number, confirmed: boolean): Intent[] {
    const sim = simulatePlan(this.session.state, actor, plan);
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
    if (last && last.action.type === 'move' && this.goal && actor.id === this.myId) {
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
        if (actor.id === this.myId || actor.kind !== 'player' || !plan) continue;
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

  /** Действие плана словами; actor — каким герой будет в момент действия (оружие, рюкзак). */
  private describeAction(action: Action, actor: Actor | null): string {
    const name = (id: string): string => this.names.get(id) ?? '?';
    const hands = actor?.weapon ?? null;
    switch (action.type) {
      case 'move':
        return t('game.step', ARROWS[action.direction]);
      case 'attack':
        return hands?.type === 'sword'
          ? t('game.swordAttackWindUp')
          : t('game.attack2', ITEM_NAMES[hands?.type ?? 'none']);
      case 'wait':
        return t('game.wait2');
      case 'equip': {
        // Во время проигрывания хода броня уже надета: план по новому состоянию не
        // прогнать (actor — null), смотрим на героя как есть.
        const item = actor?.backpack.find((i) => i.id === action.itemId);
        const armor = (item && isArmor(item)) || (actor ?? this.me())?.armor?.id === action.itemId;
        return t('game.actionItem', armor ? t('hub.wear') : t('game.take'), name(action.itemId));
      }
      case 'drop':
        return t('game.drop2', name(action.itemId));
      case 'dropCoins':
        return t('game.dropCoins2', action.amount);
      case 'dropKey':
        return t('game.dropKey2');
      case 'openDoor':
        return t('game.openDoor2');
      case 'drink':
        return t('game.drinkPotion');
    }
  }

  private describePlan(plan: Plan): string {
    const sim = this.simulate(plan);
    return plan
      .map((a, i) => {
        const phase = sim?.phaseOf[i] ?? i;
        return `${phase + 1}) ${this.describeAction(a, sim?.before[phase] ?? null)}`;
      })
      .join('  ');
  }

  private refreshStatus(): void {
    const me = this.me();
    const { turn, actors } = this.session.state;
    const watched = this.watching ? actors[this.watching] : undefined;
    const health = me ?? watched;
    this.hud.update({
      title: this.title,
      turn,
      health: health
        ? {
            name: me ? null : (this.names.get(health.id) ?? t('game.ally')),
            hp: health.hp,
            maxHp: health.maxHp,
          }
        : null,
      prompt: me ? this.choiceLine() : this.spectatorLine(),
      log: this.lastLog,
      inventory: me
        ? {
            weapon: me.weapon,
            armor: me.armor,
            backpack: me.backpack,
            coins: me.coins,
            keys: me.keys,
          }
        : null,
      banner: this.session.state.escaped[this.myId]
        ? t('game.youEscapedTheDungeon2')
        : t('game.youDied2'),
    });
  }

  /** Что сейчас выбирается: подсказка, план в работе или отправленный план. */
  private choiceLine(): string {
    const used = this.simulate(this.draft)?.used ?? 0;
    if (this.sent) return t('game.planWaitingForOthers', this.describePlan(this.sent));
    if (this.aim) {
      const blocked = this.draft[this.slot()] ? '' : t('game.cannotAttackHere');
      return t('game.aimWASDMoveTabNextTarget', blocked);
    }
    if (this.draft.length === 0) return t('game.chooseAnActionAP', ACTION_POINTS);
    const plan = t('game.plan', this.describePlan(this.draft));
    return used < ACTION_POINTS
      ? t('game.apLeftOrEnterWaitFor', plan, ACTION_POINTS - used)
      : t('game.enterToConfirm', plan);
  }

  /** В забеге выход по Esc — бросить его и потерять несённое, поэтому спрашиваем дважды. */
  private confirmBack(): void {
    const now = this.time.now;
    // Терять нечего: тренировка, или нас уже нет на уровне (погибли, вышли — ждём союзников).
    if (
      !this.isRun ||
      !this.me() ||
      (this.abandonAskedAt !== null && now - this.abandonAskedAt < ABANDON_CONFIRM_MS)
    ) {
      this.goBack();
      return;
    }
    this.abandonAskedAt = now;
    this.ui.toast(t('game.escAgainAbandonTheRunEverything'));
  }

  private goBack(): void {
    if (this.back.to === 'editor') this.scene.start(SCENES.editor, { draft: this.back.draft });
    else this.scene.start(SCENES.menu);
  }
}
