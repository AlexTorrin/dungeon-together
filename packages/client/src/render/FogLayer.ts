import Phaser from 'phaser';
import { posKey, type GameState } from '@dt/shared';
import { BACKGROUND_COLOR, DEPTH, TILE_SIZE } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';

/** Насколько затемнять исследованное, но сейчас невидимое: карту видно, монстров — нет. */
const REMEMBERED_ALPHA = 0.6;

/**
 * Туман войны поверх карты. У клетки три состояния:
 * - не исследована — закрыта целиком (цвет фона);
 * - исследована, но сейчас не видна — затемнена: стены помним, кто там — не знаем;
 * - видна — без тумана.
 * Перерисовывается целиком после каждого хода (карта небольшая).
 */
export class FogLayer {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly color = Phaser.Display.Color.HexStringToColor(BACKGROUND_COLOR).color;

  constructor(scene: Phaser.Scene, ui: UiOverlay) {
    this.g = ui.world(scene.add.graphics().setDepth(DEPTH.fog));
  }

  draw({ map, explored }: GameState, visible: ReadonlySet<string>): void {
    const g = this.g.clear();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (visible.has(posKey({ x, y }))) continue;
        g.fillStyle(this.color, explored[y * map.width + x] ? REMEMBERED_ALPHA : 1);
        g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}
