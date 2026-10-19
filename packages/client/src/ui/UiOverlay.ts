import Phaser from 'phaser';
import { UI_COLORS } from '../config';

/**
 * Отдельная камера для интерфейса. Главная камера приближена (ZOOM) и ездит за героем,
 * а UI должен оставаться в экранных координатах и в масштабе 1:1. Поэтому мир рисует
 * только главная камера, UI — только эта.
 */
export class UiOverlay {
  readonly camera: Phaser.Cameras.Scene2D.Camera;
  /** На какой высоте от низа экрана всплывают тосты (выше нижней панели HUD, если она есть). */
  toastMargin = 40;

  constructor(private readonly scene: Phaser.Scene) {
    this.camera = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);

    const onResize = (size: Phaser.Structs.Size): void => {
      this.camera.setSize(size.width, size.height);
    };
    scene.scale.on('resize', onResize);
    scene.events.once('shutdown', () => scene.scale.off('resize', onResize));
  }

  /**
   * Регистрирует объект как часть мира (UI-камера его не рисует).
   * Новые объекты по умолчанию видны обеим камерам, поэтому регистрировать нужно каждый.
   */
  world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.camera.ignore(obj);
    return obj;
  }

  /** Регистрирует объект как часть UI (главная камера его не рисует). */
  add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.scene.cameras.main.ignore(obj);
    return obj;
  }

  text(
    x: number,
    y: number,
    content: string,
    color: string = UI_COLORS.text,
  ): Phaser.GameObjects.Text {
    return this.add(
      this.scene.add.text(x, y, content, { fontFamily: 'monospace', fontSize: '14px', color }),
    );
  }

  /** Короткое всплывающее сообщение внизу экрана. */
  toast(message: string): void {
    const { width, height } = this.scene.scale;
    const t = this.add(
      this.scene.add
        .text(width / 2, height - this.toastMargin, message, {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: UI_COLORS.text,
          backgroundColor: UI_COLORS.buttonSelected,
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5),
    );
    this.scene.tweens.add({
      targets: t,
      alpha: 0,
      delay: 1200,
      duration: 400,
      onComplete: () => t.destroy(),
    });
  }
}
