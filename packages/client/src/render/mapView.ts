import Phaser from 'phaser';
import type { GameMap, Position } from '@dt/shared';
import { ANIMATIONS, TEXTURES, firstFrame } from '../assetKeys';
import { TILE_SIZE } from '../config';
import { pickTileIndex, pickTileKind } from './autotile';

/** Каждый N-й участок верхней стены получает факел — чисто декоративно. */
const TORCH_EVERY = 4;

export function tileCenter({ x, y }: Position): [number, number] {
  return [x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2];
}

/** Колбэк для каждого созданного объекта карты — сцена решает, какой камере его показывать. */
export type OnObjectCreated = (obj: Phaser.GameObjects.GameObject) => void;

/** Отрисовка карты (тайлы + факелы); setMap перерисовывает целиком. */
export class MapView {
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;
  private torches: Phaser.GameObjects.Sprite[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    map: GameMap,
    private readonly onCreated: OnObjectCreated = () => {},
  ) {
    this.setMap(map);
  }

  setMap(map: GameMap): void {
    this.tilemap?.destroy();
    for (const torch of this.torches) torch.destroy();
    this.torches = [];

    const tilemap = this.scene.make.tilemap({
      width: map.width,
      height: map.height,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = tilemap.addTilesetImage(TEXTURES.tileset);
    const ground = tileset && tilemap.createBlankLayer('ground', tileset);
    if (!ground) throw new Error('Failed to create tilemap layer');

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = pickTileIndex(map, { x, y });
        if (index !== null) ground.putTileAt(index, x, y);
      }
    }
    // Новый слой должен быть под героем/оверлеями, созданными раньше.
    ground.setDepth(-1);
    this.onCreated(ground);
    this.addTorches(map);
    this.tilemap = tilemap;
  }

  private addTorches(map: GameMap): void {
    for (let y = 0; y < map.height; y++) {
      let run = 0;
      for (let x = 0; x < map.width; x++) {
        if (pickTileKind(map, { x, y }) !== 'wallTop') {
          run = 0;
          continue;
        }
        run++;
        if (run % TORCH_EVERY === 2) {
          const torch = this.scene.add.sprite(
            ...tileCenter({ x, y }),
            firstFrame(ANIMATIONS.torch),
          );
          torch.play(ANIMATIONS.torch.key);
          torch.setDepth(-1);
          this.onCreated(torch);
          this.torches.push(torch);
        }
      }
    }
  }
}
