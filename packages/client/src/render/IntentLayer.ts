import Phaser from 'phaser';
import { step, type Action, type Position } from '@dt/shared';
import { DEPTH, INTENT_COLORS, TILE_SIZE } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';
import { tileCenter } from './mapView';

/** Что актор собирается сделать — для отрисовки. */
export interface Intent {
  readonly from: Position;
  readonly action: Action;
  readonly color: number;
  /** Подтверждено (сплошная стрелка) или только выбрано (полупрозрачная). */
  readonly confirmed: boolean;
  /** Оставшийся путь до цели мыши после этого шага — пунктиром. */
  readonly path?: readonly Position[];
}

export interface IntentScene {
  readonly intents: readonly Intent[];
  /** Клетка под курсором. */
  readonly hover: Position | null;
  readonly hoverAttackable: boolean;
  /** Клетки, которые можно ударить, — подсвечиваются, когда игрок выбирает удар. */
  readonly reach: readonly Position[];
  /** Курсор прицела с клавиатуры; valid — можно ли туда ударить. */
  readonly cursor: { readonly pos: Position; readonly valid: boolean } | null;
}

const ALPHA = { confirmed: 1, draft: 0.55, path: 0.45, reach: 0.14, hover: 0.7 } as const;
const HALF = TILE_SIZE / 2;

/** Намерения на карте: стрелки шагов, путь, перекрестия ударов, подсветка. Перерисовывается целиком. */
export class IntentLayer {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, ui: UiOverlay) {
    this.g = ui.world(scene.add.graphics().setDepth(DEPTH.intents));
  }

  draw({ intents, hover, hoverAttackable, reach, cursor }: IntentScene): void {
    const g = this.g.clear();

    g.fillStyle(INTENT_COLORS.reach, ALPHA.reach);
    for (const { x, y } of reach) g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

    if (hover) {
      const color = hoverAttackable ? INTENT_COLORS.attack : INTENT_COLORS.hover;
      g.lineStyle(1, color, ALPHA.hover);
      g.strokeRect(
        hover.x * TILE_SIZE + 0.5,
        hover.y * TILE_SIZE + 0.5,
        TILE_SIZE - 1,
        TILE_SIZE - 1,
      );
    }

    for (const intent of intents) this.drawIntent(intent);
    if (cursor) this.drawCursor(cursor.pos, cursor.valid);
  }

  /** Уголки вокруг клетки — курсор прицела. Серый — туда не ударить. */
  private drawCursor({ x, y }: Position, valid: boolean): void {
    const left = x * TILE_SIZE;
    const top = y * TILE_SIZE;
    const right = left + TILE_SIZE;
    const bottom = top + TILE_SIZE;
    const len = 4;
    this.g.lineStyle(1.5, valid ? INTENT_COLORS.cursor : INTENT_COLORS.cursorBlocked, 1);
    for (const [cx, cy, dx, dy] of [
      [left, top, 1, 1],
      [right, top, -1, 1],
      [left, bottom, 1, -1],
      [right, bottom, -1, -1],
    ] as const) {
      this.g.lineBetween(cx, cy, cx + dx * len, cy);
      this.g.lineBetween(cx, cy, cx, cy + dy * len);
    }
  }

  private drawIntent({ from, action, color, confirmed, path }: Intent): void {
    const g = this.g;
    const alpha = confirmed ? ALPHA.confirmed : ALPHA.draft;
    const [fx, fy] = tileCenter(from);

    switch (action.type) {
      case 'move': {
        const [tx, ty] = tileCenter(step(from, action.direction));
        this.arrow(fx, fy, tx, ty, color, alpha);
        g.fillStyle(color, ALPHA.path);
        for (const cell of path ?? []) {
          const [cx, cy] = tileCenter(cell);
          g.fillCircle(cx, cy, 1.5);
        }
        return;
      }
      case 'attack': {
        const [tx, ty] = tileCenter(action.target);
        g.lineStyle(1, INTENT_COLORS.attack, alpha * 0.5);
        g.lineBetween(fx, fy, tx, ty);
        g.lineStyle(1, INTENT_COLORS.attack, alpha);
        g.strokeRect(tx - HALF + 1.5, ty - HALF + 1.5, TILE_SIZE - 3, TILE_SIZE - 3);
        g.lineBetween(tx - 4, ty - 4, tx + 4, ty + 4);
        g.lineBetween(tx - 4, ty + 4, tx + 4, ty - 4);
        return;
      }
      case 'wait':
        g.lineStyle(1, color, alpha);
        g.strokeCircle(fx, fy, HALF - 2);
        return;
    }
  }

  /** Стрелка от центра клетки к центру соседней: линия и наконечник. */
  private arrow(
    fx: number,
    fy: number,
    tx: number,
    ty: number,
    color: number,
    alpha: number,
  ): void {
    const angle = Math.atan2(ty - fy, tx - fx);
    // Начинаем чуть от центра актора, заканчиваем чуть не доходя до центра цели.
    const sx = fx + Math.cos(angle) * 5;
    const sy = fy + Math.sin(angle) * 5;
    const ex = tx - Math.cos(angle) * 2;
    const ey = ty - Math.sin(angle) * 2;
    const head = 4;
    this.g.lineStyle(1.5, color, alpha);
    this.g.lineBetween(sx, sy, ex, ey);
    this.g.fillStyle(color, alpha);
    this.g.fillTriangle(
      ex,
      ey,
      ex - Math.cos(angle - 0.5) * head,
      ey - Math.sin(angle - 0.5) * head,
      ex - Math.cos(angle + 0.5) * head,
      ey - Math.sin(angle + 0.5) * head,
    );
  }
}
