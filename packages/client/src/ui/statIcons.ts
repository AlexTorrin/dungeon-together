import Phaser from 'phaser';
import { ARMORS, POTION, WEAPONS, isArmorType, type ItemType } from '@dt/shared';
import { ASSET_PATHS } from '../assetKeys';
import { UI_COLORS } from '../config';
import type { UiOverlay } from './UiOverlay';

/**
 * Характеристики значками (инфографика): урон — красные риски, дальность — клетки, ОД —
 * жёлтые кружки, защита — серые плашки. Сравнивать вещи на глаз проще, чем читать цифры.
 */

const PIP = {
  damage: { width: 4, height: 12, gap: 2, color: 0xe0503a },
  range: { size: 8, gap: 2, color: 0xb89a8c },
  ap: { radius: 4, gap: 3, color: 0xf2d17a },
  defense: { width: 6, height: 12, gap: 2, color: 0xadc1cf },
} as const;
const ICON = 16;
const GROUP_GAP = 12;
const ICON_GAP = 3;

/** Чем рисовать значки: сцена и UI-камера. */
export interface IconCanvas {
  readonly scene: Phaser.Scene;
  readonly ui: UiOverlay;
}

/** Иконка-подпись группы значков (меч — урон, стрела — дальность, кольчуга — защита). */
function label(canvas: IconCanvas, texture: string, x: number, y: number, rotation = 0): number {
  canvas.ui.add(canvas.scene.add.image(x + ICON / 2, y, texture).setRotation(rotation));
  return x + ICON + ICON_GAP;
}

function damagePips(canvas: IconCanvas, count: number, x: number, y: number): number {
  const { width, height, gap, color } = PIP.damage;
  for (let i = 0; i < count; i++) {
    canvas.ui.add(
      canvas.scene.add.rectangle(x + i * (width + gap), y, width, height, color).setOrigin(0, 0.5),
    );
  }
  return x + count * (width + gap);
}

function rangePips(canvas: IconCanvas, count: number, x: number, y: number): number {
  const { size, gap, color } = PIP.range;
  for (let i = 0; i < count; i++) {
    canvas.ui.add(
      canvas.scene.add
        .rectangle(x + i * (size + gap), y, size, size)
        .setOrigin(0, 0.5)
        .setStrokeStyle(1, color),
    );
  }
  return x + count * (size + gap);
}

function apPips(canvas: IconCanvas, count: number, x: number, y: number): number {
  const { radius, gap, color } = PIP.ap;
  for (let i = 0; i < count; i++) {
    canvas.ui.add(canvas.scene.add.circle(x + radius + i * (2 * radius + gap), y, radius, color));
  }
  return x + count * (2 * radius + gap);
}

function defensePips(canvas: IconCanvas, count: number, x: number, y: number): number {
  const { width, height, gap, color } = PIP.defense;
  for (let i = 0; i < count; i++) {
    canvas.ui.add(
      canvas.scene.add.rectangle(x + i * (width + gap), y, width, height, color).setOrigin(0, 0.5),
    );
  }
  return x + count * (width + gap);
}

/** Значки характеристик предмета слева направо от x, по центру y; возвращает x после них. */
export function drawStats(canvas: IconCanvas, type: ItemType, x: number, y: number): number {
  if (type === 'potion') {
    const heal = canvas.ui
      .text(x, y, `+${POTION.healShare * 100}% HP`, '#e0503a')
      .setOrigin(0, 0.5);
    return apPips(canvas, POTION.cost, heal.x + heal.width + GROUP_GAP, y);
  }
  if (isArmorType(type)) {
    return defensePips(canvas, ARMORS[type].defense, label(canvas, ASSET_PATHS.mailItem, x, y), y);
  }
  const { damage, range, cost } = WEAPONS[type];
  x = damagePips(canvas, damage, label(canvas, ASSET_PATHS.swordItem, x, y), y) + GROUP_GAP;
  // Стрела в паке смотрит вниз — поворачиваем вправо.
  x = rangePips(canvas, range, label(canvas, ASSET_PATHS.arrow, x, y, -Math.PI / 2), y);
  return apPips(canvas, cost, x + GROUP_GAP, y);
}

/** Легенда значков одной строкой; возвращает её высоту. */
export function drawLegend(canvas: IconCanvas, x: number, y: number): number {
  const muted = (at: number, text: string): number => {
    const t = canvas.ui.text(at + 4, y, text, UI_COLORS.muted).setOrigin(0, 0.5);
    return t.x + t.width + GROUP_GAP;
  };
  x = muted(damagePips(canvas, 1, label(canvas, ASSET_PATHS.swordItem, x, y), y), 'урон');
  x = muted(
    rangePips(canvas, 1, label(canvas, ASSET_PATHS.arrow, x, y, -Math.PI / 2), y),
    'дальность',
  );
  x = muted(apPips(canvas, 1, x, y), 'ОД');
  muted(defensePips(canvas, 1, label(canvas, ASSET_PATHS.mailItem, x, y), y), 'защита');
  return ICON;
}
