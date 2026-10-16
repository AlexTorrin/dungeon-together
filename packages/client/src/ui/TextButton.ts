import Phaser from 'phaser';
import { UI_COLORS } from '../config';

const BASE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: UI_COLORS.text,
  backgroundColor: UI_COLORS.button,
  padding: { x: 10, y: 6 },
};

/** Простая кнопка-надпись: подсветка при наведении, «выбранное» состояние для переключателей. */
export class TextButton extends Phaser.GameObjects.Text {
  private selected = false;

  constructor(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void) {
    super(scene, x, y, label, BASE_STYLE);
    scene.add.existing(this);
    this.setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.setBackgroundColor(UI_COLORS.buttonHover))
      .on('pointerout', () => this.refresh())
      .on(
        'pointerdown',
        (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          onClick();
        },
      );
  }

  setSelected(selected: boolean): this {
    this.selected = selected;
    this.refresh();
    return this;
  }

  private refresh(): void {
    this.setBackgroundColor(this.selected ? UI_COLORS.buttonSelected : UI_COLORS.button);
  }
}

/** Раскладывает объекты в строку слева направо; возвращает x после последнего. */
export function layoutRow(
  items: readonly Phaser.GameObjects.Text[],
  x: number,
  y: number,
  gap = 6,
): number {
  let cursor = x;
  for (const item of items) {
    item.setPosition(cursor, y);
    cursor += item.width + gap;
  }
  return cursor;
}
