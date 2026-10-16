import Phaser from 'phaser';
import { BACKGROUND_COLOR } from './config';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { RoomEditorScene } from './scenes/RoomEditorScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: BACKGROUND_COLOR,
  pixelArt: true, // без сглаживания при масштабировании — пиксели остаются чёткими
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [BootScene, MenuScene, GameScene, RoomEditorScene],
});

// Для отладки и автоматических проверок (скил run-game): доступ к игре из консоли в dev-режиме.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
