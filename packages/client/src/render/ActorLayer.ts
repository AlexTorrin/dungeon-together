import Phaser from 'phaser';
import {
  delta,
  step,
  type Actor,
  type ActorId,
  type Direction,
  type GameEvent,
  type GameState,
  type PlayerId,
} from '@dt/shared';
import type { Look } from '../assetKeys';
import { BUMP_DURATION_MS, DAMAGE_FLOAT_MS, DEPTH, MOVE_DURATION_MS, ZOOM } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';
import { lookOfActor } from './actorLooks';
import { tileCenter } from './mapView';

/** Смещение отметки «готов» от центра спрайта — в правый верхний угол клетки. */
const MARK_OFFSET = { x: 5, y: -10 } as const;
/** На сколько пикселей актор «дёргается» в сторону препятствия при неудачном шаге. */
const BUMP_OFFSET = 4;
const HP_BAR = { width: 12, height: 2, offsetY: 9 } as const;
const HP_COLORS = { player: 0x8fdc6a, monster: 0xe0503a, back: 0x1a0d13 } as const;

interface ActorView {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly hpBack: Phaser.GameObjects.Rectangle;
  readonly hpFill: Phaser.GameObjects.Rectangle;
  /** Только у игроков. */
  readonly mark: Phaser.GameObjects.Text | null;
}

/**
 * Акторы на экране: спрайты, полоски HP, отметки «готов», цифры урона.
 *
 * Спрайты поддерживаются сверкой с state.actors (reconciliation): новым акторам — спрайт,
 * у пропавших — убрать. Двигают спрайты только события (tween). Пока идут анимации,
 * сверка только создаёт: уничтожить или передвинуть спрайт посреди tween нельзя — его
 * onComplete не сработает и счётчик анимаций не обнулится. Остальное — после последней анимации.
 */
export class ActorLayer {
  private readonly views = new Map<ActorId, ActorView>();
  private running = 0;
  private latest: GameState | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
    private readonly localLooks: ReadonlyMap<PlayerId, Look>,
    /** Вызывается, когда закончилась последняя анимация. */
    private readonly onIdle: () => void,
  ) {}

  /** Идут ли анимации хода (пока да — ввод не принимается). */
  get busy(): boolean {
    return this.running > 0;
  }

  spriteOf(id: ActorId): Phaser.GameObjects.Sprite | undefined {
    return this.views.get(id)?.sprite;
  }

  sync(state: GameState): void {
    this.latest = state;
    for (const actor of Object.values(state.actors)) {
      if (!this.views.has(actor.id)) this.add(actor);
    }
    if (this.busy) return;

    for (const [id, view] of this.views) {
      const actor = state.actors[id];
      if (!actor) {
        this.remove(id, view);
        continue;
      }
      // Страховка от рассинхрона: в покое спрайт стоит ровно в клетке из состояния.
      view.sprite.setPosition(...tileCenter(actor.pos));
      const ratio = Math.max(0, actor.hp) / actor.maxHp;
      view.hpFill.setSize(HP_BAR.width * ratio, HP_BAR.height);
    }
    this.followSprites();
  }

  /** Подтягивает полоски и отметки к спрайтам — вызывать каждый кадр. */
  followSprites(): void {
    for (const view of this.views.values()) {
      const { x, y } = view.sprite;
      view.hpBack.setPosition(x - HP_BAR.width / 2, y + HP_BAR.offsetY);
      view.hpFill.setPosition(x - HP_BAR.width / 2, y + HP_BAR.offsetY);
      view.mark?.setPosition(x + MARK_OFFSET.x, y + MARK_OFFSET.y);
    }
  }

  setReady(id: PlayerId, ready: boolean): void {
    this.views.get(id)?.mark?.setVisible(ready);
  }

  clearReady(): void {
    for (const view of this.views.values()) view.mark?.setVisible(false);
  }

  /** Анимации событий хода. Остальные события игнорирует. */
  play(event: GameEvent): void {
    switch (event.type) {
      case 'moved': {
        const sprite = this.spriteOf(event.actorId);
        if (!sprite) return;
        this.face(sprite, event.direction);
        const [x, y] = tileCenter(event.to);
        this.animate({ targets: sprite, x, y, duration: MOVE_DURATION_MS });
        return;
      }
      case 'bumped': {
        const sprite = this.spriteOf(event.actorId);
        if (!sprite) return;
        this.face(sprite, event.direction);
        const d = step({ x: 0, y: 0 }, event.direction);
        this.animate({
          targets: sprite,
          x: sprite.x + d.x * BUMP_OFFSET,
          y: sprite.y + d.y * BUMP_OFFSET,
          duration: BUMP_DURATION_MS / 2,
          yoyo: true,
        });
        return;
      }
      case 'attacked': {
        // Анимаций ударов пока нет — только разворот в сторону цели.
        const sprite = this.spriteOf(event.actorId);
        const actor = this.latest?.actors[event.actorId];
        if (sprite && actor) {
          const dx = event.target.x - actor.pos.x;
          if (dx !== 0) sprite.setFlipX(dx < 0);
        }
        return;
      }
      case 'damaged':
        this.floatDamage(event.actorId, event.amount);
        return;
      default:
        return;
    }
  }

  private add(actor: Actor): void {
    const [x, y] = tileCenter(actor.pos);
    const { texture, frame, anim } = lookOfActor(actor, this.localLooks);
    const sprite = this.ui.world(
      this.scene.add.sprite(x, y, texture, frame).play(anim).setDepth(DEPTH.actors),
    );
    const bar = (color: number, width: number): Phaser.GameObjects.Rectangle =>
      this.ui.world(
        this.scene.add
          .rectangle(0, 0, width, HP_BAR.height, color)
          .setOrigin(0, 0.5)
          .setDepth(DEPTH.overlays),
      );
    const hpBack = bar(HP_COLORS.back, HP_BAR.width);
    const hpFill = bar(HP_COLORS[actor.kind], (HP_BAR.width * actor.hp) / actor.maxHp);
    const mark =
      actor.kind === 'player'
        ? this.ui.world(
            this.scene.add
              .text(0, 0, '✓', { fontFamily: 'monospace', fontSize: '10px', color: '#8fdc6a' })
              .setOrigin(0.5)
              .setResolution(ZOOM)
              .setDepth(DEPTH.overlays)
              .setVisible(false),
          )
        : null;
    this.views.set(actor.id, { sprite, hpBack, hpFill, mark });
    this.followSprites();
  }

  private remove(id: ActorId, view: ActorView): void {
    view.sprite.destroy();
    view.hpBack.destroy();
    view.hpFill.destroy();
    view.mark?.destroy();
    this.views.delete(id);
  }

  /**
   * Цифра урона над актором. Удар считается по позициям после шагов, поэтому всплывает
   * после анимации шага — там, где спрайт к тому моменту оказался.
   */
  private floatDamage(id: ActorId, amount: number): void {
    const sprite = this.spriteOf(id);
    if (!sprite) return;
    const text = this.ui.world(
      this.scene.add
        .text(sprite.x, sprite.y, `-${amount}`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#ff6b57',
          stroke: '#1a0d13',
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setResolution(ZOOM)
        .setDepth(DEPTH.floaters)
        .setVisible(false),
    );
    this.animate({
      targets: text,
      delay: MOVE_DURATION_MS,
      y: '-=10',
      alpha: { from: 1, to: 0 },
      duration: DAMAGE_FLOAT_MS,
      onStart: () => text.setPosition(sprite.x, sprite.y - 6).setVisible(true),
      onCompleteExtra: () => text.destroy(),
    });
  }

  private face(sprite: Phaser.GameObjects.Sprite, direction: Direction): void {
    const { x } = delta(direction);
    if (x !== 0) sprite.setFlipX(x < 0);
  }

  /** tween с учётом в счётчике: пока он > 0, ввод заблокирован, а сверка отложена. */
  private animate(
    config: Phaser.Types.Tweens.TweenBuilderConfig & { onCompleteExtra?: () => void },
  ): void {
    const { onCompleteExtra, ...tween } = config;
    this.running++;
    this.scene.tweens.add({
      ...tween,
      onComplete: () => {
        onCompleteExtra?.();
        this.running--;
        if (this.running === 0) {
          if (this.latest) this.sync(this.latest);
          this.onIdle();
        }
      },
    });
  }
}
