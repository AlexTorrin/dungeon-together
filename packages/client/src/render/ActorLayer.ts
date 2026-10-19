import Phaser from 'phaser';
import {
  delta,
  posKey,
  step,
  type Actor,
  type ActorId,
  type Direction,
  type GameEvent,
  type GameState,
  type PlayerId,
  type Position,
} from '@dt/shared';
import type { Look } from '../assetKeys';
import { BUMP_DURATION_MS, DAMAGE_FLOAT_MS, DEPTH, MOVE_DURATION_MS, ZOOM } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';
import { lookOfActor } from './actorLooks';
import { CombatFx, HIT_MS } from './combatFx';
import { tileCenter } from './mapView';

/** Смещение отметки «готов» от центра спрайта — в правый верхний угол клетки. */
const MARK_OFFSET = { x: 5, y: -10 } as const;
/** На сколько пикселей актор «дёргается» в сторону препятствия при неудачном шаге. */
const BUMP_OFFSET = 4;
const HP_BAR = { width: 12, height: 2, offsetY: 9 } as const;
const HP_COLORS = { player: 0x8fdc6a, monster: 0xe0503a, back: 0x1a0d13 } as const;
/** Подпись с именем: низ подписи — столько пикселей над центром спрайта (выше отметки «готов»). */
const NAME_OFFSET_Y = -12;
const NAME_COLORS = { mine: '#f2d17a', other: '#e8dcc8' } as const;

/** Имена игроков над героями (сетевая игра); в одиночной — пусто, подписей нет. */
export interface PlayerLabels {
  readonly names: Readonly<Record<PlayerId, string>>;
  /** Наш игрок — его имя другим цветом. */
  readonly mine: PlayerId;
}

interface ActorView {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly hpBack: Phaser.GameObjects.Rectangle;
  readonly hpFill: Phaser.GameObjects.Rectangle;
  /** Только у игроков. */
  readonly mark: Phaser.GameObjects.Text | null;
  /** Имя над героем — только в сетевой игре. */
  readonly label: Phaser.GameObjects.Text | null;
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
  /** Клетки, которые сейчас видит команда (posKey). Монстров вне их не показываем. */
  private visible: ReadonlySet<string> = new Set();
  /** Последнее состояние — чем бьёт атакующий (стрела или заряд палочки). */
  private state: GameState | null = null;
  /**
   * Когда (мс от начала фазы) удар атакующего достигает цели и когда попали по актору: по
   * ним урон, «мимо» и гибель показываются в момент попадания, а не сразу после шагов.
   */
  private readonly impactAt = new Map<ActorId, number>();
  private readonly hitAt = new Map<ActorId, number>();
  private readonly fx: CombatFx;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
    private readonly localLooks: ReadonlyMap<PlayerId, Look>,
    /** Вызывается, когда закончилась последняя анимация. */
    private readonly onIdle: () => void,
    private readonly labels: PlayerLabels | null = null,
  ) {
    this.fx = new CombatFx(scene, ui, (config) => this.animate(config));
  }

  /** Идут ли анимации хода (пока да — ввод не принимается). */
  get busy(): boolean {
    return this.running > 0;
  }

  spriteOf(id: ActorId): Phaser.GameObjects.Sprite | undefined {
    return this.views.get(id)?.sprite;
  }

  /**
   * Готовит спрайты к новому состоянию, не двигая их: создаёт спрайты новым акторам и
   * показывает/прячет по туману войны. Двигают спрайты события (play), выравнивает — sync.
   */
  prepare(state: GameState, visible: ReadonlySet<string>): void {
    this.state = state;
    this.visible = visible;
    for (const actor of Object.values(state.actors)) {
      if (!this.views.has(actor.id)) this.add(actor);
      const view = this.views.get(actor.id);
      if (view) this.setShown(view, actor.kind === 'player' || visible.has(posKey(actor.pos)));
    }
  }

  /**
   * Сверка с состоянием, когда анимации закончились: убрать спрайты пропавших акторов,
   * поставить всех ровно в их клетки, обновить полоски HP. Посреди анимаций только prepare.
   */
  sync(state: GameState, visible: ReadonlySet<string>): void {
    this.prepare(state, visible);
    if (this.busy) return;

    this.impactAt.clear();
    this.hitAt.clear();
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
      view.label?.setPosition(x, y + NAME_OFFSET_Y);
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
        // Удар — после шагов фазы: разворот к цели, выпад или выстрел.
        const sprite = this.spriteOf(event.actorId);
        const target = tileCenter(event.target);
        let impact = MOVE_DURATION_MS;
        if (sprite) {
          const dx = target[0] - sprite.x;
          if (dx !== 0) sprite.setFlipX(dx < 0);
          const weapon = this.state?.actors[event.actorId]?.weapon?.type ?? null;
          if (sprite.visible) impact = this.fx.strike(sprite, target, weapon, MOVE_DURATION_MS);
        }
        this.impactAt.set(event.actorId, impact);
        return;
      }
      case 'damaged': {
        const at = this.impactDelay(event.by);
        this.hitAt.set(event.actorId, at);
        const sprite = this.spriteOf(event.actorId);
        if (!sprite?.visible) return; // урон по невидимому — не показываем
        const attacker = this.spriteOf(event.by);
        this.fx.hit(sprite, attacker ? [attacker.x, attacker.y] : null, at);
        // Полоска HP падает в момент попадания (у погибшего актора в состоянии уже нет — 0).
        const maxHp = this.state?.actors[event.actorId]?.maxHp;
        const ratio = maxHp ? Math.max(0, event.hp) / maxHp : 0;
        const fill = this.views.get(event.actorId)?.hpFill;
        this.scene.time.delayedCall(at, () => fill?.setSize(HP_BAR.width * ratio, HP_BAR.height));
        this.floatText(`-${event.amount}`, '#ff6b57', at, () => [sprite.x, sprite.y - 6]);
        return;
      }
      case 'died': {
        // Погибший гаснет после вспышки попадания; убирает спрайт сверка в конце хода.
        const view = this.views.get(event.actorId);
        if (view?.sprite.visible)
          this.fx.death(
            view.sprite,
            [view.hpBack, view.hpFill, ...(view.label ? [view.label] : [])],
            this.hitDelay(event.actorId) + HIT_MS,
          );
        return;
      }
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
    this.views.set(actor.id, { sprite, hpBack, hpFill, mark, label: this.addLabel(actor) });
    this.followSprites();
  }

  private addLabel(actor: Actor): Phaser.GameObjects.Text | null {
    const name =
      actor.kind === 'player' && this.labels && Object.hasOwn(this.labels.names, actor.id)
        ? this.labels.names[actor.id]
        : undefined;
    if (!this.labels || name === undefined) return null;
    const color = actor.id === this.labels.mine ? NAME_COLORS.mine : NAME_COLORS.other;
    return this.ui.world(
      this.scene.add
        .text(0, 0, name, {
          fontFamily: 'monospace',
          fontSize: '7px',
          color,
          stroke: '#1a0d13',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setResolution(ZOOM)
        .setDepth(DEPTH.overlays),
    );
  }

  /** Туман войны: монстра вне поля зрения команды не видно — ни спрайта, ни полоски HP. */
  private setShown(view: ActorView, shown: boolean): void {
    view.sprite.setVisible(shown);
    view.hpBack.setVisible(shown);
    view.hpFill.setVisible(shown);
    view.label?.setVisible(shown);
    if (!shown) view.mark?.setVisible(false);
  }

  private remove(id: ActorId, view: ActorView): void {
    view.sprite.destroy();
    view.hpBack.destroy();
    view.hpFill.destroy();
    view.mark?.destroy();
    view.label?.destroy();
    this.views.delete(id);
  }

  /** Через сколько мс от начала фазы удар этого атакующего достиг цели. */
  impactDelay(attackerId: ActorId): number {
    return this.impactAt.get(attackerId) ?? MOVE_DURATION_MS;
  }

  /** Через сколько мс от начала фазы по актору попали (для тряски камеры и гибели). */
  hitDelay(id: ActorId): number {
    return this.hitAt.get(id) ?? MOVE_DURATION_MS;
  }

  /** Удар пришёлся в пустую клетку — «мимо» над ней (вызывающий проверяет, что клетку видно). */
  floatMiss(at: Position, attackerId: ActorId): void {
    const [x, y] = tileCenter(at);
    this.floatText('мимо', '#b89a8c', this.impactDelay(attackerId), () => [x, y - 4]);
  }

  /**
   * Всплывающая надпись через delay мс — в момент попадания. Цель могла до него идти шагом,
   * поэтому позицию берём в момент старта.
   */
  private floatText(
    content: string,
    color: string,
    delay: number,
    at: () => [number, number],
  ): void {
    const text = this.ui.world(
      this.scene.add
        .text(0, 0, content, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color,
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
      delay,
      y: '-=10',
      alpha: { from: 1, to: 0 },
      duration: DAMAGE_FLOAT_MS,
      onStart: () => text.setPosition(...at()).setVisible(true),
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
        if (this.running === 0) this.onIdle();
      },
    });
  }
}
