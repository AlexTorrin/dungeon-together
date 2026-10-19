import Phaser from 'phaser';
import type { WeaponType } from '@dt/shared';
import { ASSET_PATHS } from '../assetKeys';
import { DEPTH, TILE_SIZE } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';

/** Выпад к цели и обратно. Попадание — в его крайней точке, на середине. */
const LUNGE_MS = 150;
const LUNGE_OFFSET = 3;
/** Скорость стрелы и заряда палочки: столько мс на клетку. */
const PROJECTILE_MS_PER_TILE = 45;
const SLASH_MS = 180;
/** Радиус дуги взмаха: чем тяжелее оружие, тем шире. Кулаки — без дуги. */
const SLASH_RADIUS: Readonly<Record<WeaponType, number>> = {
  knife: 6,
  sword: 9,
  bow: 6,
  wand: 6,
};
const SLASH_SPREAD = 1.1; // полуугол дуги, рад
const SLASH_COLOR = 0xffe9a8;
const BOLT = { radius: 2, color: 0x9be7ff } as const;
/** Попавший: вспышка белым и отскок от удара. */
export const HIT_MS = 160;
const KNOCKBACK = 3;
const DEATH_TINT = 0xe0503a;
const DEATH_SINK = 3;
const DEATH_FADE_MS = 300;

/** Твин, учтённый в счётчике анимаций ActorLayer (onComplete занят счётчиком). */
export type Animate = (
  config: Phaser.Types.Tweens.TweenBuilderConfig & { onCompleteExtra?: () => void },
) => void;

type Point = readonly [number, number];

/**
 * Боевые эффекты — только картинка: кто попал и сколько, решил shared. Ассетов с анимацией
 * удара в паке нет, поэтому всё — твины спрайтов и простая графика (procedural animation).
 */
export class CombatFx {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
    private readonly animate: Animate,
  ) {}

  /**
   * Удар из клетки атакующего по клетке-цели, начиная с startAt мс: рядом — выпад и взмах,
   * издалека — летящая стрела или заряд. Возвращает, через сколько мс удар достигнет цели.
   */
  strike(
    attacker: Phaser.GameObjects.Sprite,
    target: Point,
    weapon: WeaponType | null,
    startAt: number,
  ): number {
    const from: Point = [attacker.x, attacker.y];
    const dx = target[0] - from[0];
    const dy = target[1] - from[1];
    const tiles = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / TILE_SIZE);
    if (tiles > 1) return this.projectile(from, target, weapon, startAt, tiles);

    const impact = startAt + LUNGE_MS / 2;
    this.animate({
      targets: attacker,
      x: from[0] + Math.sign(dx) * LUNGE_OFFSET,
      y: from[1] + Math.sign(dy) * LUNGE_OFFSET,
      delay: startAt,
      duration: LUNGE_MS / 2,
      ease: 'Quad.easeOut',
      yoyo: true,
    });
    if (weapon) this.slash(target, Math.atan2(dy, dx), SLASH_RADIUS[weapon], impact);
    return impact;
  }

  /** Попадание в at мс: спрайт вспыхивает белым и отскакивает в сторону от удара. */
  hit(sprite: Phaser.GameObjects.Sprite, from: Point | null, at: number): void {
    const angle = from ? Math.atan2(sprite.y - from[1], sprite.x - from[0]) : 0;
    const push = from ? KNOCKBACK : 0;
    let base: Point = [sprite.x, sprite.y];
    const progress = { t: 0 };
    this.animate({
      targets: progress,
      t: 1,
      delay: at,
      duration: HIT_MS,
      // Позицию берём в момент попадания: до него спрайт мог ещё идти шагом.
      onStart: () => {
        base = [sprite.x, sprite.y];
        sprite.setTintFill(0xffffff);
      },
      onUpdate: () => {
        const offset = Math.sin(progress.t * Math.PI) * push;
        sprite.setPosition(base[0] + Math.cos(angle) * offset, base[1] + Math.sin(angle) * offset);
        if (progress.t > 0.4) sprite.clearTint();
      },
      onCompleteExtra: () => sprite.clearTint().setPosition(...base),
    });
  }

  /** Гибель: краснеет, оседает и гаснет — вместе с полоской HP и подписью (fading). */
  death(
    sprite: Phaser.GameObjects.Sprite,
    fading: readonly { setAlpha(value: number): unknown }[],
    at: number,
  ): void {
    let baseY = sprite.y;
    const progress = { t: 0 };
    this.animate({
      targets: progress,
      t: 1,
      delay: at,
      duration: DEATH_FADE_MS,
      onStart: () => {
        baseY = sprite.y;
        sprite.setTint(DEATH_TINT);
      },
      onUpdate: () => {
        sprite.setY(baseY + progress.t * DEATH_SINK).setAlpha(1 - progress.t);
        for (const object of fading) object.setAlpha(1 - progress.t);
      },
    });
  }

  private projectile(
    from: Point,
    to: Point,
    weapon: WeaponType | null,
    startAt: number,
    tiles: number,
  ): number {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const shot: Phaser.GameObjects.Image | Phaser.GameObjects.Arc =
      weapon === 'bow'
        ? // стрела в паке смотрит вниз — поворачиваем по направлению полёта
          this.scene.add.image(...from, ASSET_PATHS.arrow).setRotation(angle - Math.PI / 2)
        : this.scene.add.circle(...from, BOLT.radius, BOLT.color);
    this.ui.world(shot.setDepth(DEPTH.floaters).setVisible(false));
    const flight = tiles * PROJECTILE_MS_PER_TILE;
    this.animate({
      targets: shot,
      x: to[0],
      y: to[1],
      delay: startAt,
      duration: flight,
      onStart: () => shot.setVisible(true),
      onCompleteExtra: () => shot.destroy(),
    });
    return startAt + flight;
  }

  /** Дуга взмаха поперёк удара, выгнутая через клетку цели. */
  private slash(target: Point, angle: number, radius: number, at: number): void {
    const graphics = this.scene.add.graphics({ x: target[0], y: target[1] });
    graphics
      .lineStyle(2, SLASH_COLOR)
      .beginPath()
      .arc(
        -Math.cos(angle) * radius * 0.6,
        -Math.sin(angle) * radius * 0.6,
        radius,
        angle - SLASH_SPREAD,
        angle + SLASH_SPREAD,
      )
      .strokePath();
    this.ui.world(graphics.setDepth(DEPTH.floaters).setVisible(false));
    this.animate({
      targets: graphics,
      alpha: { from: 1, to: 0 },
      scale: { from: 0.7, to: 1.15 },
      delay: at,
      duration: SLASH_MS,
      onStart: () => graphics.setVisible(true),
      onCompleteExtra: () => graphics.destroy(),
    });
  }
}
