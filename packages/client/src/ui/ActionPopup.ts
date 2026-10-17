import Phaser from 'phaser';
import type { Position } from '@dt/shared';
import { TILE_SIZE } from '../config';
import { TextButton } from './TextButton';
import type { UiOverlay } from './UiOverlay';

export interface PopupOption {
  readonly label: string;
  /** Выбор пункта — он же подтверждение действия. */
  readonly onPick: () => void;
  /** Наведение — показать намерение заранее (null — ничего не показывать). */
  readonly onHover: (() => void) | null;
}

/**
 * Всплывашка с действиями рядом с клеткой: «Идти», «Ударить», «Ждать», «Отмена».
 * Живёт в UI-камере, поэтому позицию клетки переводим из мировых координат в экранные.
 */
export class ActionPopup {
  private buttons: TextButton[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
  ) {}

  get isOpen(): boolean {
    return this.buttons.length > 0;
  }

  show(tile: Position, options: readonly PopupOption[]): void {
    this.hide();
    const cam = this.scene.cameras.main;
    const sx = ((tile.x + 1) * TILE_SIZE - cam.worldView.x) * cam.zoom + 6;
    let sy = (tile.y * TILE_SIZE - cam.worldView.y) * cam.zoom;

    for (const option of options) {
      const button = this.ui.add(new TextButton(this.scene, sx, sy, option.label, option.onPick));
      button.setDepth(10);
      if (option.onHover) button.on('pointerover', option.onHover);
      this.buttons.push(button);
      sy += button.height + 2;
    }
    // Не вылезать за правый и нижний край экрана.
    const { width, height } = this.scene.scale;
    const right = Math.max(...this.buttons.map((b) => b.x + b.width));
    const bottom = sy;
    const shiftX = right > width ? right - width + 4 : 0;
    const shiftY = bottom > height ? bottom - height + 4 : 0;
    for (const b of this.buttons) b.setPosition(b.x - shiftX, b.y - shiftY);
  }

  hide(): void {
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
  }
}
