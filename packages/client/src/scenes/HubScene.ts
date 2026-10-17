import Phaser from 'phaser';
import {
  PRICES,
  SHOP_STOCK,
  WEAPONS,
  BACKPACK_SIZE,
  applyHubAction,
  itemAt,
  sellPrice,
  type HubAction,
  type Profile,
  type Slot,
  type ItemType,
  PLAYER_MAX_HP,
  POTION,
  potionHeal,
} from '@dt/shared';
import { UI_COLORS } from '../config';
import { fetchProfile, profileErrorText, sendHubAction } from '../net/profileApi';
import { ITEM_NAMES } from '../ui/names';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES } from './sceneKeys';

const COLUMN_WIDTH = 380;
const ROW_HEIGHT = 36;

function stats(type: ItemType): string {
  if (type === 'potion') {
    return `лечит половину HP (+${potionHeal(PLAYER_MAX_HP)}), выпить — ${POTION.cost} ОД`;
  }
  const { damage, range, cost } = WEAPONS[type];
  return `урон ${damage}, дальн. ${range}, ${cost} ОД`;
}

export interface HubSceneData {
  /** Профиль уже получен с сервера (перерисовка после действия); нет — запросить. */
  readonly profile?: Profile;
}

/**
 * Лагерь между забегами: магазин, снаряжение (руки и рюкзак — идут в забег) и сундук.
 * Профиль живёт на сервере: кнопка шлёт действие (HubAction), сервер применяет его правилами
 * из shared и возвращает новый профиль, сцена перерисовывается (scene.restart). Какие кнопки
 * показать, сцена решает теми же правилами — чтобы не предлагать заведомо невозможное.
 */
export class HubScene extends Phaser.Scene {
  private ui!: UiOverlay;
  private profile: Profile | null = null;
  /** Ждём ответа сервера — повторные клики игнорируем. */
  private busy = false;

  constructor() {
    super(SCENES.hub);
  }

  init(data: HubSceneData): void {
    this.profile = data.profile ?? null;
    this.busy = false;
  }

  create(): void {
    this.ui = new UiOverlay(this);
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
    const back = this.ui.add(new TextButton(this, 0, 0, '← в меню (Esc)', () => this.goBack()));
    layoutRow([back], left + 220, top + 4);
    this.input.keyboard?.on('keydown-ESC', () => this.goBack());
    const onResize = (): void => this.redraw();
    this.scale.once('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));

    const profile = this.profile;
    if (!profile) {
      const status = this.ui.text(left, top + 44, 'Загружаем профиль с сервера…', UI_COLORS.muted);
      fetchProfile()
        .then((loaded) => {
          if (!this.scene.isActive()) return;
          this.profile = loaded;
          this.redraw();
        })
        .catch((error: unknown) => {
          if (this.scene.isActive()) status.setText(profileErrorText(error));
        });
      return;
    }
    this.ui.text(left, top + 44, `Кошелёк: ${profile.coins} мон.`);

    let y = top + 84;
    // При узком экране колонки встают друг под другом.
    const shopY = y;
    y = this.drawShop(profile, col(0), shopY);
    const gearY = columns > 1 ? shopY : y + 24;
    y = this.drawGear(profile, col(1), gearY);
    const chestY = columns > 2 ? shopY : y + 24;
    this.drawChest(profile, col(2), chestY, height);
  }

  private drawShop(profile: Profile, x: number, y: number): number {
    this.ui.text(x, y, 'Магазин', UI_COLORS.muted);
    y += 28;
    for (const type of SHOP_STOCK) {
      const label = this.ui.text(0, 0, `${ITEM_NAMES[type]} — ${PRICES[type]} мон.`);
      label.setPadding(0, 6, 0, 6);
      const row: Phaser.GameObjects.Text[] = [label];
      this.addButton(row, profile, 'купить', { type: 'buy', item: type });
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

  private drawGear(profile: Profile, x: number, y: number): number {
    this.ui.text(x, y, 'Снаряжение — идёт в забег', UI_COLORS.muted);
    y += 28;
    this.ui.text(x, y, 'В руках:', UI_COLORS.muted);
    y += 22;
    y = this.drawItem(profile, x, y, { place: 'hands' }, ['backpack', 'chest']);
    this.ui.text(x, y, `Рюкзак (${profile.backpack.length}/${BACKPACK_SIZE}):`, UI_COLORS.muted);
    y += 22;
    if (profile.backpack.length === 0) {
      this.ui.text(x, y, 'пусто');
      y += ROW_HEIGHT;
    }
    profile.backpack.forEach((_, index) => {
      y = this.drawItem(profile, x, y, { place: 'backpack', index }, ['hands', 'chest']);
    });
    this.ui.text(x, y, 'Погибнете — снаряжение пропадёт.', UI_COLORS.muted);
    return y + 24;
  }

  /** Сундук: одинаковые предметы — одной строкой «лук ×3», действия берут первый из них. */
  private drawChest(profile: Profile, x: number, y: number, height: number): void {
    this.ui.text(x, y, `Сундук (${profile.chest.length})`, UI_COLORS.muted);
    y += 28;
    const types = [...new Set(profile.chest)];
    if (types.length === 0) this.ui.text(x, y, 'пусто');
    for (const type of types) {
      if (y > height - ROW_HEIGHT) break;
      const count = profile.chest.filter((t) => t === type).length;
      const index = profile.chest.indexOf(type);
      y = this.drawItem(profile, x, y, { place: 'chest', index }, ['hands', 'backpack'], count);
    }
  }

  /** Строка предмета: название и кнопки — только те действия, что сейчас возможны. */
  private drawItem(
    profile: Profile,
    x: number,
    y: number,
    slot: Slot,
    targets: readonly Slot['place'][],
    count = 1,
  ): number {
    const type = itemAt(profile, slot);
    const name = type ? ITEM_NAMES[type] : ITEM_NAMES.none;
    const label = this.ui.text(0, 0, `${name}${count > 1 ? ` ×${count}` : ''}`.padEnd(11));
    label.setPadding(0, 6, 0, 6);
    const row: Phaser.GameObjects.Text[] = [label];
    if (type) {
      const titles = { hands: 'в руки', backpack: 'в рюкзак', chest: 'в сундук' } as const;
      for (const to of targets) {
        this.addButton(row, profile, titles[to], { type: 'move', from: slot, to });
      }
      this.addButton(row, profile, `продать ${sellPrice(type)}`, { type: 'sell', slot });
    }
    layoutRow(row, x, y);
    return y + ROW_HEIGHT;
  }

  /** Кнопка действия — только если по правилам оно сейчас возможно. */
  private addButton(
    row: Phaser.GameObjects.Text[],
    profile: Profile,
    label: string,
    action: HubAction,
  ): void {
    if (!applyHubAction(profile, action)) return;
    row.push(this.ui.add(new TextButton(this, 0, 0, label, () => this.send(action))));
  }

  private send(action: HubAction): void {
    if (this.busy) return;
    this.busy = true;
    sendHubAction(action)
      .then((profile) => {
        if (!this.scene.isActive()) return;
        this.profile = profile;
        this.redraw();
      })
      .catch((error: unknown) => {
        this.busy = false;
        if (this.scene.isActive()) this.ui.toast(profileErrorText(error));
      });
  }

  private redraw(): void {
    const data: HubSceneData = this.profile ? { profile: this.profile } : {};
    this.scene.restart(data);
  }

  private goBack(): void {
    this.scene.start(SCENES.menu);
  }
}
