import Phaser from 'phaser';
import type { Door } from '@dt/shared';
import { ASSET_PATHS } from '../assetKeys';
import { DEPTH } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';
import { tileCenter } from './mapView';

/**
 * Дверь-выход поверх карты: закрытая — доски, открытая — тёмный проём. Под туманом
 * (рисуется ниже него), поэтому неисследованную дверь не видно.
 */
export class DoorView {
  private sprite: Phaser.GameObjects.Image | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
  ) {}

  sync(door: Door | null): void {
    if (!door) {
      this.sprite?.destroy();
      this.sprite = null;
      return;
    }
    const texture = door.open ? ASSET_PATHS.doorOpen : ASSET_PATHS.doorClosed;
    if (!this.sprite) {
      this.sprite = this.ui.world(
        this.scene.add.image(...tileCenter(door.pos), texture).setDepth(DEPTH.door),
      );
    } else this.sprite.setTexture(texture).setPosition(...tileCenter(door.pos));
  }
}
