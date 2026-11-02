import type Phaser from 'phaser';
import { TextButton } from './TextButton';
import type { UiOverlay } from './UiOverlay';

export const MENU_COLORS = { gold: '#e8bb72', border: 0x624333 } as const;

/** Панели меню используют ту же UI-камеру, что и остальные экраны. */
export function menuPanel(
  scene: Phaser.Scene,
  ui: UiOverlay,
  x: number,
  y: number,
  width: number,
  height: number,
  caption: string,
): void {
  ui.add(
    scene.add
      .rectangle(x, y, width, height, 0x21151d, 0.96)
      .setOrigin(0)
      .setStrokeStyle(1, MENU_COLORS.border),
  );
  ui.add(scene.add.rectangle(x, y, 3, 28, 0xe8bb72).setOrigin(0));
  ui.text(x + 22, y + 18, caption, MENU_COLORS.gold).setFontSize(12);
}

export function menuButton(
  scene: Phaser.Scene,
  ui: UiOverlay,
  x: number,
  y: number,
  width: number,
  label: string,
  onClick: () => void,
  primary = false,
): TextButton {
  const button = ui.add(new TextButton(scene, x, y, label, onClick));
  button.setFontSize(15).setPadding(8, 14, 8, 14).setFixedSize(width, 46).setAlign('center');
  if (primary) {
    button.setSelected(true).setColor('#fff0ce');
  }
  return button;
}
