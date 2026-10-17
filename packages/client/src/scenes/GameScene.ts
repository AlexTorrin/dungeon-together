import Phaser from 'phaser';
import {
  createGameState,
  step,
  type Action,
  type ActorId,
  type Direction,
  type GameEvent,
  type PlayerId,
} from '@dt/shared';
import { ANIMATIONS, SHEET_ANIMATIONS, lookOf, type Look } from '../assetKeys';
import { BUMP_DURATION_MS, MOVE_DURATION_MS, TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import type { GameSession } from '../game/GameSession';
import { LocalGame } from '../game/LocalGame';
import { MapView, tileCenter } from '../render/mapView';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES, type GameReturn, type GameSceneData } from './sceneKeys';

/** Смещение отметки «готов» от центра спрайта — в правый верхний угол клетки. */
const MARK_OFFSET = { x: 5, y: -10 } as const;
/** На сколько пикселей герой «дёргается» в сторону препятствия при неудачном шаге. */
const BUMP_OFFSET = 4;

type KeyCode = number;
const K = Phaser.Input.Keyboard.KeyCodes;

/** Игрок за этой клавиатурой: его id, клавиши и внешний вид. */
interface LocalPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly move: Readonly<Record<Direction, readonly KeyCode[]>>;
  readonly wait: readonly KeyCode[];
  readonly look: Look;
}

const SOLO: LocalPlayer = {
  id: 'p1',
  name: 'Игрок 1',
  move: { up: [K.W, K.UP], down: [K.S, K.DOWN], left: [K.A, K.LEFT], right: [K.D, K.RIGHT] },
  wait: [K.SPACE],
  look: lookOf(ANIMATIONS.heroIdle),
};

const HOT_SEAT: readonly LocalPlayer[] = [
  { ...SOLO, move: { up: [K.W], down: [K.S], left: [K.A], right: [K.D] } },
  {
    id: 'p2',
    name: 'Игрок 2',
    move: { up: [K.UP], down: [K.DOWN], left: [K.LEFT], right: [K.RIGHT] },
    wait: [K.ENTER],
    look: lookOf(SHEET_ANIMATIONS.ranger),
  },
];

/**
 * Seed для новой локальной игры. Случайность берётся здесь, в клиенте: shared детерминирован
 * и получает seed готовым. В сетевой игре seed будет выбирать сервер.
 */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/**
 * Игровая сцена. Ходы одновременные: каждый локальный игрок выбирает действие,
 * сцена отправляет его в session и ждёт. Когда выбрали все, session возвращает события
 * разрешённого хода — их анимации проигрываются одновременно, и только потом
 * принимается ввод на следующий ход.
 */
export class GameScene extends Phaser.Scene {
  private session!: GameSession;
  private back!: GameReturn;
  private localPlayers: readonly LocalPlayer[] = [];
  private keys = new Map<KeyCode, Phaser.Input.Keyboard.Key>();
  private sprites = new Map<ActorId, Phaser.GameObjects.Sprite>();
  private readyMarks = new Map<PlayerId, Phaser.GameObjects.Text>();
  private status!: Phaser.GameObjects.Text;
  /** Сколько анимаций хода ещё идёт; пока > 0, ввод не принимается. */
  private runningAnimations = 0;

  constructor() {
    super(SCENES.game);
  }

  init(data: GameSceneData): void {
    this.back = data.back;
    this.localPlayers = data.playerCount === 2 ? HOT_SEAT : [SOLO];
    this.session = new LocalGame(
      createGameState(
        data.room,
        this.localPlayers.map((p) => p.id),
        randomSeed(),
      ),
    );
    this.keys = new Map();
    this.sprites = new Map();
    this.readyMarks = new Map();
    this.runningAnimations = 0;
  }

  create(): void {
    const ui = new UiOverlay(this);
    const { state } = this.session;
    new MapView(this, state.map, (obj) => ui.world(obj));

    for (const local of this.localPlayers) {
      const player = state.actors[local.id];
      if (player?.kind !== 'player') throw new Error(`Player ${local.id} missing`);
      const [x, y] = tileCenter(player.pos);
      const { texture, frame, anim } = local.look;
      const sprite = ui.world(this.add.sprite(x, y, texture, frame).play(anim));
      this.sprites.set(local.id, sprite);

      const mark = ui.world(
        this.add
          .text(x + MARK_OFFSET.x, y + MARK_OFFSET.y, '✓', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#8fdc6a',
          })
          .setOrigin(0.5)
          .setResolution(ZOOM)
          .setDepth(1) // поверх всех персонажей, иначе соседний спрайт её закроет
          .setVisible(false),
      );
      this.readyMarks.set(local.id, mark);
    }

    const { map } = state;
    const camera = this.cameras.main
      .setZoom(ZOOM)
      .setBounds(-TILE_SIZE, -TILE_SIZE, (map.width + 2) * TILE_SIZE, (map.height + 2) * TILE_SIZE);
    const first = this.sprites.get(this.localPlayers[0]?.id ?? '');
    if (first) camera.startFollow(first, true, 0.15, 0.15);

    const backLabel = this.back.to === 'editor' ? 'в редактор' : 'в меню';
    const controls =
      this.localPlayers.length === 1
        ? 'WASD / стрелки — ход · Пробел — пропустить'
        : 'И1: WASD, Пробел · И2: стрелки, Enter';
    ui.text(12, 10, `${controls} · Esc — ${backLabel}`, UI_COLORS.muted);
    this.status = ui.text(12, 30, '');
    this.refreshStatus();

    this.registerKeys();
    this.input.keyboard?.on('keydown-ESC', () => this.goBack());
  }

  override update(): void {
    if (this.runningAnimations > 0) return;
    for (const local of this.localPlayers) {
      if (this.session.state.pendingActions[local.id]) continue; // уже выбрал — ждёт остальных
      const action = this.readAction(local);
      if (!action) continue;
      this.handleEvents(
        this.session.dispatch({ type: 'submitAction', playerId: local.id, action }),
      );
      if (this.runningAnimations > 0) return; // ход разрешился — остальной ввод после анимаций
    }
  }

  // ---------- Ввод ----------

  private registerKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input unavailable');
    for (const local of this.localPlayers) {
      for (const code of [...Object.values(local.move).flat(), ...local.wait]) {
        if (!this.keys.has(code)) this.keys.set(code, kb.addKey(code));
      }
    }
  }

  private isHeld(codes: readonly KeyCode[]): boolean {
    return codes.some((code) => this.keys.get(code)?.isDown);
  }

  /** Нажата ли клавиша с прошлой проверки (одно нажатие = одно срабатывание). */
  private wasPressed(codes: readonly KeyCode[]): boolean {
    return codes.some((code) => {
      const key = this.keys.get(code);
      return key !== undefined && Phaser.Input.Keyboard.JustDown(key);
    });
  }

  private readAction(local: LocalPlayer): Action | null {
    for (const [direction, codes] of Object.entries(local.move) as [Direction, KeyCode[]][]) {
      if (this.isHeld(codes)) return { type: 'move', direction };
    }
    // Движение можно держать — его притормаживает анимация шага. У пропуска хода анимации нет,
    // поэтому он срабатывает только на нажатие, иначе удержание пролистывало бы ход каждый кадр.
    return this.wasPressed(local.wait) ? { type: 'wait' } : null;
  }

  // ---------- События → анимации ----------

  /** Превращает события логики в анимации. Сама логика уже применена в session. */
  private handleEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'actionSubmitted':
          this.readyMarks.get(event.playerId)?.setVisible(true);
          break;
        case 'moved': {
          const sprite = this.sprites.get(event.actorId);
          if (!sprite) break;
          this.face(sprite, event.direction);
          const [x, y] = tileCenter(event.to);
          this.animate({ targets: sprite, x, y, duration: MOVE_DURATION_MS });
          break;
        }
        case 'bumped': {
          const sprite = this.sprites.get(event.actorId);
          if (!sprite) break;
          this.face(sprite, event.direction);
          const delta = step({ x: 0, y: 0 }, event.direction);
          this.animate({
            targets: sprite,
            x: sprite.x + delta.x * BUMP_OFFSET,
            y: sprite.y + delta.y * BUMP_OFFSET,
            duration: BUMP_DURATION_MS / 2,
            yoyo: true,
          });
          break;
        }
        case 'waited':
          break;
        case 'turnResolved':
          for (const mark of this.readyMarks.values()) mark.setVisible(false);
          break;
      }
    }
    this.refreshStatus();
  }

  /** Запускает tween и учитывает его в runningAnimations, чтобы заблокировать ввод до конца хода. */
  private animate(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    this.runningAnimations++;
    this.tweens.add({
      ...config,
      onUpdate: () => this.syncMarks(),
      onComplete: () => {
        this.runningAnimations--;
        this.syncMarks();
      },
    });
  }

  private face(sprite: Phaser.GameObjects.Sprite, direction: Direction): void {
    if (direction === 'left') sprite.setFlipX(true);
    if (direction === 'right') sprite.setFlipX(false);
  }

  private syncMarks(): void {
    for (const [id, mark] of this.readyMarks) {
      const sprite = this.sprites.get(id);
      if (sprite) mark.setPosition(sprite.x + MARK_OFFSET.x, sprite.y + MARK_OFFSET.y);
    }
  }

  private refreshStatus(): void {
    const { turn, pendingActions } = this.session.state;
    if (this.localPlayers.length === 1) {
      this.status.setText(`Ход ${turn}`);
      return;
    }
    const players = this.localPlayers
      .map((p) => `${p.name}: ${pendingActions[p.id] ? 'готов ✓' : 'выбирает…'}`)
      .join(' · ');
    this.status.setText(`Ход ${turn} · ${players}`);
  }

  private goBack(): void {
    if (this.back.to === 'editor') this.scene.start(SCENES.editor, { draft: this.back.draft });
    else this.scene.start(SCENES.menu);
  }
}
