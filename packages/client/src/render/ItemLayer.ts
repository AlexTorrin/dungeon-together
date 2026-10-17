import Phaser from 'phaser';
import type { GameState, GroundItem, ItemId } from '@dt/shared';
import { ITEM_LOOKS } from '../assetKeys';
import { DEPTH } from '../config';
import type { UiOverlay } from '../ui/UiOverlay';
import { tileCenter } from './mapView';

/** Предметы на полу — сверка с state.items, как у акторов (см. ActorLayer). */
export class ItemLayer {
  private readonly sprites = new Map<ItemId, Phaser.GameObjects.Image>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
  ) {}

  sync(state: GameState): void {
    for (const item of Object.values(state.items)) {
      const sprite = this.sprites.get(item.id);
      if (sprite) sprite.setPosition(...tileCenter(item.pos));
      else this.sprites.set(item.id, this.create(item));
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
