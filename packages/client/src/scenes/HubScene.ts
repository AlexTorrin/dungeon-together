import Phaser from 'phaser';
import {
  PRICES,
  SHOP_STOCK,
  WEAPONS,
  BACKPACK_SIZE,
  buy,
  itemAt,
  move,
  sell,
  sellPrice,
  type Profile,
  type Slot,
  type WeaponType,
} from '@dt/shared';
import { UI_COLORS } from '../config';
import { loadProfile, saveProfile } from '../storage/profileStorage';
import { WEAPON_NAMES } from '../ui/names';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES } from './sceneKeys';

const COLUMN_WIDTH = 380;
const ROW_HEIGHT = 36;

function stats(type: WeaponType): string {
  const { damage, range, cost } = WEAPONS[type];
  return `урон ${damage}, дальн. ${range}, ${cost} ОД`;
}

/**
 * Лагерь между забегами: магазин, снаряжение (руки и рюкзак — идут в забег) и сундук.
 * Каждое действие — чистая функция из shared/hub; сцена только сохраняет результат и
 * перерисовывается (scene.restart), своей логики у неё нет.
 */
export class HubScene extends Phaser.Scene {
  private ui!: UiOverlay;
  private profile!: Profile;

  constructor() {
    super(SCENES.hub);
  }

  create(): void {
    this.ui = new UiOverlay(this);
    this.profile = loadProfile();
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(UI_COLORS.panel);

    const columns = Math.max(1, Math.min(3, Math.floor((width - 48) / COLUMN_WIDTH)));
    const left = Math.max(24, (width - columns * COLUMN_WIDTH) / 2);
    const col = (i: number): number => left + (i % columns) * COLUMN_WIDTH;
    const top = 24;
    this.ui.add(
      this.add.text(left, top, 'Лагерь', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: UI_COLORS.text,
      }),
    );
    this.ui.text(left, top + 44, `Кошелёк: ${this.profile.coins} мон.`);
    const back = this.ui.add(new TextButton(this, 0, 0, '← в меню (Esc)', () => this.goBack()));
    layoutRow([back], left + 220, top + 4);

    let y = top + 84;
    // При узком экране колонки встают друг под другом.
    const shopY = y;
    y = this.drawShop(col(0), shopY);
    const gearY = columns > 1 ? shopY : y + 24;
    y = this.drawGear(col(1), gearY);
    const chestY = columns > 2 ? shopY : y + 24;
    this.drawChest(col(2), chestY, height);

    this.input.keyboard?.on('keydown-ESC', () => this.goBack());
    const onResize = (): void => {
      this.scene.restart();
    };
    this.scale.once('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
  }

  private drawShop(x: number, y: number): number {
    this.ui.text(x, y, 'Магазин', UI_COLORS.muted);
    y += 28;
    for (const type of SHOP_STOCK) {
      const label = this.ui.text(0, 0, `${WEAPON_NAMES[type]} — ${PRICES[type]} мон.`);
      label.setPadding(0, 6, 0, 6);
      const next = buy(this.profile, type);
      const row: Phaser.GameObjects.Text[] = [label];
      if (next) row.push(this.button('купить', next));
      layoutRow(row, x, y);
      this.ui.text(x, y + 28, stats(type), UI_COLORS.muted);
      y += ROW_HEIGHT + 20;
    }
    this.ui.text(
      x,
      y,
      `Продажа — за полцены. Покупка — в рюкзак,\nа если он полон — в сундук.`,
      UI_COLORS.muted,
    );
    return y + 40;
  }

  private drawGear(x: number, y: number): number {
    this.ui.text(x, y, 'Снаряжение — идёт в забег', UI_COLORS.muted);
    y += 28;
    this.ui.text(x, y, 'В руках:', UI_COLORS.muted);
    y += 22;
    y = this.drawItem(x, y, { place: 'hands' }, ['backpack', 'chest']);
    this.ui.text(
      x,
      y,
      `Рюкзак (${this.profile.backpack.length}/${BACKPACK_SIZE}):`,
      UI_COLORS.muted,
    );
    y += 22;
    if (this.profile.backpack.length === 0) {
      this.ui.text(x, y, 'пусто');
      y += ROW_HEIGHT;
    }
    this.profile.backpack.forEach((_, index) => {
      y = this.drawItem(x, y, { place: 'backpack', index }, ['hands', 'chest']);
    });
    this.ui.text(x, y, 'Погибнете — снаряжение пропадёт.', UI_COLORS.muted);
    return y + 24;
  }

  /** Сундук: одинаковые предметы — одной строкой «лук ×3», действия берут первый из них. */
  private drawChest(x: number, y: number, height: number): void {
    this.ui.text(x, y, `Сундук (${this.profile.chest.length})`, UI_COLORS.muted);
    y += 28;
    const types = [...new Set(this.profile.chest)];
    if (types.length === 0) this.ui.text(x, y, 'пусто');
    for (const type of types) {
      if (y > height - ROW_HEIGHT) break;
      const count = this.profile.chest.filter((t) => t === type).length;
      const index = this.profile.chest.indexOf(type);
      y = this.drawItem(x, y, { place: 'chest', index }, ['hands', 'backpack'], count);
    }
  }

  /** Строка предмета: название и кнопки — только те действия, что сейчас возможны. */
  private drawItem(
    x: number,
    y: number,
    slot: Slot,
    targets: readonly Slot['place'][],
    count = 1,
  ): number {
    const type = itemAt(this.profile, slot);
    const name = type ? WEAPON_NAMES[type] : WEAPON_NAMES.none;
    const label = this.ui.text(0, 0, `${name}${count > 1 ? ` ×${count}` : ''}`.padEnd(11));
    label.setPadding(0, 6, 0, 6);
    const row: Phaser.GameObjects.Text[] = [label];
    if (type) {
      const titles = { hands: 'в руки', backpack: 'в рюкзак', chest: 'в сундук' } as const;
      for (const to of targets) {
        const next = move(this.profile, slot, to);
        if (next) row.push(this.button(titles[to], next));
      }
      const sold = sell(this.profile, slot);
      if (sold) row.push(this.button(`продать ${sellPrice(type)}`, sold));
    }
    layoutRow(row, x, y);
    return y + ROW_HEIGHT;
  }

  private button(label: string, next: Profile): TextButton {
    return this.ui.add(
      new TextButton(this, 0, 0, label, () => {
        if (!saveProfile(next)) {
          this.ui.toast('Не удалось сохранить (localStorage недоступен)');
          return;
        }
        this.scene.restart();
      }),
    );
  }

  private goBack(): void {
    this.scene.start(SCENES.menu);
  }
}
