import Phaser from 'phaser';
import {
  BACKPACK_SIZE,
  PRICES,
  SHOP_STOCK,
  applyHubAction,
  itemAt,
  sellPrice,
  type HubAction,
  type ItemType,
  type Profile,
  type Slot,
} from '@dt/shared';
import {
  ANIMATIONS,
  ASSET_PATHS,
  SHEET_ANIMATIONS,
  TEXTURES,
  firstFrame,
  itemTexture,
} from '../assetKeys';
import { UI_COLORS } from '../config';
import { fetchProfile, profileErrorText, sendHubAction } from '../net/profileApi';
import { ITEM_NAMES } from '../ui/names';
import { drawLegend, drawStats, type IconCanvas } from '../ui/statIcons';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import { SCENES } from './sceneKeys';

/** Сцена у костра сверху; карточки — под ней. */
const HEADER = 112;
const MARGIN = 24;
const COLUMN_WIDTH = 400;
const COLUMN_GAP = 16;
const PAD = 12;
/** Строка предмета: ячейка с иконкой, рядом — название и значки, ниже — кнопки. */
const ROW = 56;
/** Строка магазина — в одну линию: кнопка одна. */
const SHOP_ROW = 46;
const CELL = 42;
const NAME_WIDTH = 100;
const CARD_TITLE = 28;
const CARD_BORDER = 0x5a3550;
const FLOOR_FRAME = 6; // плитка пола в тайлсете
const FLOOR_SCALE = 3;
const FLOOR_TINT = 0x8a7a80;
const SPRITE_SCALE = 4;
const FIRE_GLOW = 0xd1851e;

export interface HubSceneData {
  /** Профиль уже получен с сервера (перерисовка после действия); нет — запросить. */
  readonly profile?: Profile;
  /** Прокрутка (узкое окно) — чтобы после покупки экран не прыгал наверх. */
  readonly scrollY?: number;
}

/** Где рисуется карточка и докуда она дошла. */
interface Card {
  readonly x: number;
  readonly width: number;
  readonly back: Phaser.GameObjects.Rectangle;
  readonly top: number;
  y: number;
}

/**
 * Лагерь между забегами: магазин, снаряжение (руки, броня и рюкзак — идут в забег) и сундук.
 * Профиль живёт на сервере: кнопка шлёт действие (HubAction), сервер применяет его правилами
 * из shared и возвращает новый профиль, сцена перерисовывается (scene.restart). Какие кнопки
 * показать, сцена решает теми же правилами — чтобы не предлагать заведомо невозможное.
 *
 * Оформление: пол подземелья, костёр с мерцающим светом, герой и сундук; предметы — иконками,
 * характеристики — значками (ui/statIcons). Всё рисует UI-камера в экранных координатах.
 */
export class HubScene extends Phaser.Scene {
  private ui!: UiOverlay;
  private profile: Profile | null = null;
  /** Ждём ответа сервера — повторные клики игнорируем. */
  private busy = false;
  private scrollY = 0;

  constructor() {
    super(SCENES.hub);
  }

  init(data: HubSceneData): void {
    this.profile = data.profile ?? null;
    this.scrollY = data.scrollY ?? 0;
    this.busy = false;
  }

  create(): void {
    this.ui = new UiOverlay(this);
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(UI_COLORS.panel);
    this.drawCamp(width);

    this.ui.add(
      this.add.text(MARGIN, 18, 'Лагерь', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: UI_COLORS.text,
      }),
    );
    const back = this.ui.add(new TextButton(this, 0, 0, '← в меню (Esc)', () => this.goBack()));
    back.setPosition(width - MARGIN - back.width, 20);
    this.input.keyboard?.on('keydown-ESC', () => this.goBack());
    const onResize = (): void => this.redraw();
    this.scale.once('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));

    const profile = this.profile;
    if (!profile) {
      const status = this.ui.text(MARGIN, 64, 'Загружаем профиль с сервера…', UI_COLORS.muted);
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
    this.drawWallet(profile.coins, MARGIN, 74);

    // Колонки по ширине окна: 3 — магазин, снаряжение, сундук; 2 — сундук под магазином; 1 — всё подряд.
    const columns = Math.max(
      1,
      Math.min(3, Math.floor((width - 2 * MARGIN + COLUMN_GAP) / (COLUMN_WIDTH + COLUMN_GAP))),
    );
    const left = Math.max(MARGIN, (width - columns * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_GAP) / 2);
    const col = (i: number): number => left + (i % columns) * (COLUMN_WIDTH + COLUMN_GAP);
    const top = HEADER;
    const shopEnd = this.drawShop(profile, col(0), top);
    const gearTop = columns > 1 ? top : shopEnd + COLUMN_GAP;
    const gearEnd = this.drawGear(profile, col(1), gearTop);
    const chestTop = columns > 2 ? top : columns > 1 ? shopEnd + COLUMN_GAP : gearEnd + COLUMN_GAP;
    const chestEnd = this.drawChest(profile, col(2), chestTop);
    this.enableScroll(Math.max(shopEnd, gearEnd, chestEnd) + MARGIN, height);
  }

  /** Не влезло в окно (узкое — всё в одну колонку) — колесо мыши прокручивает UI-камеру. */
  private enableScroll(contentBottom: number, height: number): void {
    const max = Math.max(0, contentBottom - height);
    const camera = this.ui.camera;
    camera.setScroll(0, Phaser.Math.Clamp(this.scrollY, 0, max));
    if (max === 0) return;
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      camera.setScroll(0, Phaser.Math.Clamp(camera.scrollY + dy, 0, max));
    });
  }

  // ---------- Фон: пол и костёр ----------

  private drawCamp(width: number): void {
    const { height } = this.scale;
    this.ui.add(
      this.add
        .tileSprite(0, 0, width, height, TEXTURES.tileset, FLOOR_FRAME)
        .setOrigin(0)
        .setTileScale(FLOOR_SCALE)
        .setScrollFactor(0)
        .setTint(FLOOR_TINT),
    );
    const cx = width / 2;
    const cy = HEADER / 2 + 6;
    // Свет костра: два круга с аддитивным смешиванием (ADD — цвет прибавляется к фону, как
    // свет), мерцают твином с разной частотой — выглядит живее одного ровного пульса.
    const glow = (radius: number, alpha: number, ms: number): void => {
      const circle = this.ui.add(
        this.add.circle(cx, cy + 8, radius, FIRE_GLOW, alpha).setBlendMode(Phaser.BlendModes.ADD),
      );
      this.tweens.add({
        targets: circle,
        scale: { from: 0.92, to: 1.06 },
        alpha: { from: alpha * 0.8, to: alpha },
        duration: ms,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    };
    glow(150, 0.16, 420);
    glow(70, 0.26, 260);
    this.ui.add(
      this.add
        .sprite(cx, cy, TEXTURES.campfire, 0)
        .setScale(SPRITE_SCALE)
        .play(SHEET_ANIMATIONS.campfire.key),
    );
    this.ui.add(
      this.add
        .sprite(cx - 84, cy + 4, firstFrame(ANIMATIONS.heroIdle))
        .setScale(SPRITE_SCALE)
        .play(ANIMATIONS.heroIdle.key),
    );
    this.ui.add(this.add.image(cx + 84, cy + 8, ASSET_PATHS.chest).setScale(SPRITE_SCALE));
  }

  private drawWallet(coins: number, x: number, y: number): void {
    this.ui.add(this.add.image(x + 8, y, firstFrame(ANIMATIONS.coin)).setScale(2));
    this.ui.text(x + 24, y, `${coins} мон. в кошельке`).setOrigin(0, 0.5);
  }

  // ---------- Карточки ----------

  private openCard(x: number, top: number, title: string): Card {
    const back = this.ui.add(
      this.add
        .rectangle(x, top, COLUMN_WIDTH, 1, UI_COLORS.panel, 0.9)
        .setOrigin(0)
        .setStrokeStyle(1, CARD_BORDER),
    );
    this.ui.text(x + PAD, top + 8, title, UI_COLORS.muted);
    return { x, width: COLUMN_WIDTH, back, top, y: top + CARD_TITLE };
  }

  private note(card: Card, text: string): void {
    const note = this.ui.text(card.x + PAD, card.y, text, UI_COLORS.muted);
    note.setWordWrapWidth(card.width - 2 * PAD);
    card.y += note.height + 8;
  }

  /** Закрыть карточку: подложка — по содержимому. Возвращает низ карточки. */
  private closeCard(card: Card): number {
    const bottom = card.y + 4;
    card.back.setSize(card.width, bottom - card.top);
    return bottom;
  }

  /** Ячейка с иконкой предмета (или прочерком); caption — мелко в углу, как в HUD. */
  private cell(x: number, y: number, type: ItemType | null, caption = ''): void {
    this.ui.add(
      this.add.rectangle(x, y, CELL, CELL, 0x2a1720).setOrigin(0).setStrokeStyle(1, CARD_BORDER),
    );
    const iconY = y + CELL / 2 + (caption ? 3 : 0);
    if (type) {
      this.ui.add(this.add.image(x + CELL / 2, iconY, itemTexture(type)).setScale(2));
    } else {
      this.ui.text(x + CELL / 2, iconY, '—', UI_COLORS.muted).setOrigin(0.5);
    }
    if (caption) {
      this.ui.add(
        this.add.text(x + 3, y + 1, caption, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: UI_COLORS.muted,
        }),
      );
    }
  }

  private canvas(): IconCanvas {
    return { scene: this, ui: this.ui };
  }

  private drawShop(profile: Profile, x: number, top: number): number {
    const card = this.openCard(x, top, 'Магазин');
    for (const type of SHOP_STOCK) {
      const y = card.y;
      this.cell(x + PAD, y, type);
      const mid = y + CELL / 2;
      const textX = x + PAD + CELL + 10;
      this.ui.text(textX, mid, ITEM_NAMES[type]).setOrigin(0, 0.5);
      drawStats(this.canvas(), type, textX + 76, mid);
      // Справа — цена и кнопка; не хватает монет — вместо кнопки цена приглушённо.
      const price = PRICES[type];
      const action: HubAction = { type: 'buy', item: type };
      const right = x + card.width - PAD;
      if (applyHubAction(profile, action)) {
        const buy = this.ui.add(
          new TextButton(this, 0, 0, `купить ${price}`, () => this.send(action)),
        );
        buy.setPosition(right - buy.width, mid - buy.height / 2);
      } else {
        this.ui.text(right, mid, `${price} мон.`, UI_COLORS.muted).setOrigin(1, 0.5);
      }
      card.y += SHOP_ROW;
    }
    card.y += 4;
    card.y += drawLegend(this.canvas(), x + PAD, card.y + 8) + 10;
    this.note(card, 'Продажа — за полцены. Купленное — в рюкзак, а если он полон — в сундук.');
    return this.closeCard(card);
  }

  private drawGear(profile: Profile, x: number, top: number): number {
    const card = this.openCard(x, top, 'Снаряжение — идёт в забег');
    this.drawItem(card, profile, 'руки', { place: 'hands' }, ['backpack', 'chest']);
    this.drawItem(card, profile, 'броня', { place: 'armor' }, ['backpack', 'chest']);
    for (let index = 0; index < BACKPACK_SIZE; index++) {
      const caption = `${index + 1}`;
      if (index < profile.backpack.length) {
        const targets = ['hands', 'armor', 'chest'] as const;
        this.drawItem(card, profile, caption, { place: 'backpack', index }, targets);
      } else {
        this.drawEmpty(card, caption);
      }
    }
    this.note(card, 'Погибнете — снаряжение пропадёт.');
    return this.closeCard(card);
  }

  /** Сундук: одинаковые предметы — одной строкой «лук ×3», действия берут первый из них. */
  private drawChest(profile: Profile, x: number, top: number): number {
    const card = this.openCard(x, top, `Сундук (${profile.chest.length}) — в безопасности`);
    const types = [...new Set(profile.chest)];
    if (types.length === 0) this.note(card, 'пусто — сюда можно убрать вещи из снаряжения');
    for (const type of types) {
      const count = profile.chest.filter((t) => t === type).length;
      const index = profile.chest.indexOf(type);
      const targets = ['hands', 'armor', 'backpack'] as const;
      this.drawItem(card, profile, '', { place: 'chest', index }, targets, count);
    }
    return this.closeCard(card);
  }

  /** Пустой слот снаряжения: ячейка с прочерком и подпись. */
  private drawEmpty(card: Card, caption: string): void {
    this.cell(card.x + PAD, card.y, null, caption);
    this.ui
      .text(card.x + PAD + CELL + 10, card.y + CELL / 2, 'пусто', UI_COLORS.muted)
      .setOrigin(0, 0.5);
    card.y += CELL + 6;
  }

  /**
   * Строка предмета: ячейка с иконкой; справа сверху — название и значки характеристик, снизу —
   * кнопки, только те действия, что сейчас возможны.
   */
  private drawItem(
    card: Card,
    profile: Profile,
    caption: string,
    slot: Slot,
    targets: readonly Slot['place'][],
    count = 1,
  ): void {
    const type = itemAt(profile, slot);
    if (!type) {
      this.drawEmpty(card, caption);
      return;
    }
    const { x } = card;
    const y = card.y;
    this.cell(x + PAD, y, type, caption);
    const textX = x + PAD + CELL + 10;
    const name = `${ITEM_NAMES[type]}${count > 1 ? ` ×${count}` : ''}`;
    this.ui.text(textX, y + 8, name).setOrigin(0, 0.5);
    drawStats(this.canvas(), type, textX + NAME_WIDTH, y + 8);
    const titles = { hands: 'в руки', armor: 'надеть', backpack: 'в рюкзак', chest: 'в сундук' };
    const row: Phaser.GameObjects.Text[] = [];
    for (const to of targets) {
      this.addButton(row, profile, titles[to], { type: 'move', from: slot, to });
    }
    this.addButton(row, profile, `продать ${sellPrice(type)}`, { type: 'sell', slot });
    layoutRow(row, textX, y + 20);
    card.y += ROW;
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
    const data: HubSceneData = this.profile
      ? { profile: this.profile, scrollY: this.ui.camera.scrollY }
      : {};
    this.scene.restart(data);
  }

  private goBack(): void {
    this.scene.start(SCENES.menu);
  }
}
