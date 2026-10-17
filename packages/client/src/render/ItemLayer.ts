import Phaser from 'phaser';
import { posKey, type GameState, type GroundItem, type ItemId } from '@dt/shared';
import { ITEM_LOOKS } from '../assetKeys';
import { DEPTH } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';
import { tileCenter } from './mapView';

/**
 * Предметы на полу — сверка с state.items, как у акторов (см. ActorLayer).
 * Видны только в клетках, которые сейчас видит команда (туман войны).
 */
export class ItemLayer {
  private readonly sprites = new Map<ItemId, Phaser.GameObjects.Image>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
  ) {}

  sync(state: GameState, visible: ReadonlySet<string>): void {
    for (const item of Object.values(state.items)) {
      let sprite = this.sprites.get(item.id);
      if (sprite) sprite.setPosition(...tileCenter(item.pos));
      else this.sprites.set(item.id, (sprite = this.create(item)));
      sprite.setVisible(visible.has(posKey(item.pos)));
    }
    for (const [id, sprite] of this.sprites) {
      if (state.items[id]) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  private create(item: GroundItem): Phaser.GameObjects.Image {
    const look = ITEM_LOOKS[item.type];
    return this.ui.world(
      this.scene.add.image(...tileCenter(item.pos), look.texture, look.frame).setDepth(DEPTH.items),
    );
  }
}
