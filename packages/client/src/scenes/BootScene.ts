import Phaser from 'phaser';
import { ANIMATIONS, ASSET_PATHS, SHEET_ANIMATIONS, TEXTURES } from '../assetKeys';
import { TILE_SIZE } from '../config';
import { SCENES } from './sceneKeys';

/** Загружает все ассеты и регистрирует анимации, затем передаёт управление DungeonScene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  preload(): void {
    const sheet = { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE };
    this.load.spritesheet(TEXTURES.tileset, ASSET_PATHS.tileset, sheet);
    this.load.spritesheet(TEXTURES.characters, ASSET_PATHS.characters, sheet);
    for (const path of [
      ASSET_PATHS.knifeItem,
      ASSET_PATHS.bowItem,
      ASSET_PATHS.swordItem,
      ASSET_PATHS.wandItem,
      ASSET_PATHS.leatherItem,
      ASSET_PATHS.mailItem,
      ASSET_PATHS.doorClosed,
      ASSET_PATHS.doorOpen,
    ]) {
      this.load.image(path, path);
    }
    this.load.image(TEXTURES.walls, ASSET_PATHS.walls);

    for (const anim of Object.values(ANIMATIONS)) {
      for (const path of anim.frames) this.load.image(path, path);
    }
  }

  create(): void {
    for (const anim of Object.values(ANIMATIONS)) {
      this.anims.create({
        key: anim.key,
        frames: anim.frames.map((path) => ({ key: path })),
        frameRate: anim.frameRate,
        repeat: -1,
      });
    }
    for (const anim of Object.values(SHEET_ANIMATIONS)) {
      this.anims.create({
        key: anim.key,
        frames: this.anims.generateFrameNumbers(anim.texture, { frames: [...anim.frames] }),
        frameRate: anim.frameRate,
        repeat: -1,
      });
    }
    this.scene.start(SCENES.menu);
  }
}
