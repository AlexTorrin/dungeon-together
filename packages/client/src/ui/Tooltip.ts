import Phaser from 'phaser';
import { UI_COLORS } from '../config';
import type { UiOverlay } from './UiOverlay';

const PAD = { x: 10, y: 8 } as const;
/** Зазор между тултипом и тем, над чем он висит, и отступ от краёв экрана. */
const GAP = 6;
const BORDER = 0x8a4b2f;

/**
 * Подсказка при наведении: первая строка — название, ниже — подробности. Висит над объектом
 * (anchor, экранные координаты), прижимается к краям экрана, рисуется поверх всего UI.
 */
export class Tooltip {
  private readonly back: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private readonly container: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    ui: UiOverlay,
  ) {
    const style = { fontFamily: 'monospace', fontSize: '13px', lineSpacing: 4 } as const;
    this.back = scene.add
      .rectangle(0, 0, 1, 1, UI_COLORS.panel, 0.97)
      .setOrigin(0)
      .setStrokeStyle(1, BORDER);
    this.title = scene.add.text(PAD.x, PAD.y, '', { ...style, color: UI_COLORS.text });
    this.body = scene.add.text(PAD.x, 0, '', { ...style, color: UI_COLORS.muted });
    this.container = ui.add(
      scene.add.container(0, 0, [this.back, this.title, this.body]).setDepth(30).setVisible(false),
    );
  }

  /** text — «Название\nподробности…»; anchor — прямоугольник, над которым показать. */
  show(text: string, anchor: Phaser.Geom.Rectangle): void {
    const [title = '', ...rest] = text.split('\n');
    this.title.setText(title);
    this.body.setText(rest.join('\n')).setY(PAD.y + this.title.height + (rest.length ? 4 : 0));
    const width = Math.max(this.title.width, this.body.width) + 2 * PAD.x;
    const height = (rest.length ? this.body.y + this.body.height : this.title.height) + PAD.y;
    this.back.setSize(width, height);
    const screen = this.scene.scale;
    const x = Phaser.Math.Clamp(anchor.x, GAP, screen.width - width - GAP);
    const above = anchor.y - height - GAP;
    const y = above >= GAP ? above : anchor.bottom + GAP;
    this.container.setPosition(x, y).setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
  }
}
