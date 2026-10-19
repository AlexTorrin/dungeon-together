import Phaser from 'phaser';
import {
  ARMORS,
  BACKPACK_SIZE,
  UNARMED,
  WEAPONS,
  type ArmorItem,
  type Item,
  type WeaponItem,
} from '@dt/shared';
import { ANIMATIONS, firstFrame, itemTexture } from '../assetKeys';
import { UI_COLORS } from '../config';
import { ITEM_NAMES } from './names';
import type { UiOverlay } from './UiOverlay';

/** Высота верхней панели (заголовок, HP, план, лог) и нижней (инвентарь), в экранных пикселях. */
export const HUD_TOP = 76;
export const HUD_BOTTOM = 64;

const PAD = 12;
const MAX_SCREEN_WIDTH = 8192;
const SLOT = 44;
const SLOT_GAP = 6;
/** Спрайты предметов 16×16 — в ячейке вдвое крупнее. */
const ICON_SCALE = 2;
const HP_BAR = { width: 140, height: 10 } as const;
const HP_COLORS = { back: 0x3b2433, fill: 0x6cc24a, low: 0xe0503a } as const;
/** Ниже этой доли HP полоска красная. */
const LOW_HP = 0.3;
const SLOT_COLORS = { fill: 0x2a1720, border: 0x5a3550, hover: 0x8a4b2f } as const;

const HELP_INTRO =
  'Ход — 2 очка действия (ОД); все выбирают план, потом он разыгрывается в две фазы';

/** Справка: клавиша — что делает. Две колонки отдельными текстами: пробелами не выровнять. */
const helpRows = (backLabel: string): readonly (readonly [string, string])[] => [
  ['WASD / стрелки', 'шаг; две клавиши сразу — по диагонали'],
  ['Shift + WASD', 'удар в эту сторону (пока Shift зажат, видно, куда достать)'],
  ['F', 'прицел: WASD — курсор, Tab — следующая цель, Enter — ударить'],
  ['Пробел', 'ждать'],
  ['1–4', 'из рюкзака: взять в руки / надеть / выпить (или клик по ячейке)'],
  ['Shift + 1–4', 'выбросить из рюкзака'],
  ['Q', 'выбросить то, что в руках'],
  ['E', 'открыть дверь ключом (стоя рядом)'],
  ['Enter', 'подтвердить план (недостающее — ждать)'],
  ['Backspace', 'убрать последнее действие'],
  ['ПКМ / Esc', 'очистить план (отправленный — отозвать)'],
  ['Клик по клетке', 'меню действий; двойной клик — сразу ход'],
  ['Esc', `${backLabel} (в забеге — дважды: бросить забег, вещи пропадут)`],
  ['Tab', 'погибли или вышли — следить за следующим союзником'],
  ['H', 'закрыть справку'],
];

/** Чьё здоровье показать: своё или того, за кем следим. */
export interface HudHealth {
  /** null — своё; иначе имя союзника, за которым следим. */
  readonly name: string | null;
  readonly hp: number;
  readonly maxHp: number;
}

export interface HudInventory {
  readonly weapon: WeaponItem | null;
  readonly armor: ArmorItem | null;
  readonly backpack: readonly Item[];
  readonly coins: number;
  readonly keys: number;
}

/** Что показать в HUD; собирает сцена из состояния игры. */
export interface HudView {
  readonly title: string;
  readonly turn: number;
  readonly health: HudHealth | null;
  /** Строка выбора хода (или «смотрите за …» у наблюдателя). */
  readonly prompt: string;
  /** Лог прошлого хода. */
  readonly log: string;
  /** null — своего героя нет (погиб, вышел): вместо инвентаря — плашка. */
  readonly inventory: HudInventory | null;
  /** Плашка внизу, когда инвентаря нет. */
  readonly banner: string;
}

interface Slot {
  readonly box: Phaser.GameObjects.Rectangle;
  readonly icon: Phaser.GameObjects.Image;
  readonly caption: Phaser.GameObjects.Text;
  readonly empty: Phaser.GameObjects.Text;
}

/**
 * Интерфейс игровой сцены: сверху — уровень, ход, HP, план и лог; снизу — инвентарь ячейками
 * с иконками; по H — справка по клавишам. Живёт в UI-камере (экранные координаты, 1:1) и
 * перестраивается при изменении размера окна. Логики игры здесь нет: сцена отдаёт HudView.
 */
export class Hud {
  private readonly top: Phaser.GameObjects.Rectangle;
  private readonly bottom: Phaser.GameObjects.Rectangle;
  private readonly head: Phaser.GameObjects.Text;
  private readonly hpBack: Phaser.GameObjects.Rectangle;
  private readonly hpFill: Phaser.GameObjects.Rectangle;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly helpHint: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;
  private readonly log: Phaser.GameObjects.Text;
  private readonly slots: Slot[];
  private readonly coinIcon: Phaser.GameObjects.Image;
  private readonly coins: Phaser.GameObjects.Text;
  private readonly keyIcon: Phaser.GameObjects.Image;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly help: Phaser.GameObjects.Container;
  private view: HudView | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ui: UiOverlay,
    /** Куда ведёт Esc: «в меню» или «в редактор». */
    backLabel: string,
    /** Клик по ячейке рюкзака (номер с нуля) — как клавиши 1–4. */
    onBackpackSlot: (index: number) => void,
  ) {
    // Панели ловят клики, чтобы клик по ним не считался кликом по карте под ними; зона клика —
    // с запасом по ширине, чтобы не пересчитывать её при изменении размера окна.
    const panel = (height: number): Phaser.GameObjects.Rectangle =>
      ui.add(
        scene.add
          .rectangle(0, 0, 1, height, UI_COLORS.panel, 0.9)
          .setOrigin(0)
          .setInteractive(
            new Phaser.Geom.Rectangle(0, 0, MAX_SCREEN_WIDTH, height),
            Phaser.Geom.Rectangle.Contains,
          ),
      );
    this.top = panel(HUD_TOP);
    this.bottom = panel(HUD_BOTTOM);
    ui.toastMargin = HUD_BOTTOM + 28;
    this.head = ui.text(PAD, 8, '');
    this.hpBack = ui.add(scene.add.rectangle(0, 0, HP_BAR.width, HP_BAR.height, HP_COLORS.back));
    this.hpFill = ui.add(scene.add.rectangle(0, 0, HP_BAR.width, HP_BAR.height, HP_COLORS.fill));
    this.hpBack.setOrigin(0, 0.5);
    this.hpFill.setOrigin(0, 0.5);
    this.hpText = ui.text(0, 0, '');
    this.helpHint = ui.text(0, 8, 'H — клавиши', UI_COLORS.muted).setOrigin(1, 0);
    this.prompt = ui.text(PAD, 30, '');
    this.log = ui.text(PAD, 50, '', UI_COLORS.muted);

    const captions = [
      'руки',
      'броня',
      ...Array.from({ length: BACKPACK_SIZE }, (_, i) => `${i + 1}`),
    ];
    this.slots = captions.map((caption, index) => {
      const box = ui.add(
        scene.add
          .rectangle(0, 0, SLOT, SLOT, SLOT_COLORS.fill)
          .setOrigin(0)
          .setStrokeStyle(1, SLOT_COLORS.border),
      );
      const backpackIndex = index - 2;
      if (backpackIndex >= 0) {
        box.setInteractive({ useHandCursor: true });
        box.on('pointerover', () => box.setStrokeStyle(2, SLOT_COLORS.hover));
        box.on('pointerout', () => box.setStrokeStyle(1, SLOT_COLORS.border));
        box.on('pointerdown', () => onBackpackSlot(backpackIndex));
      }
      return {
        box,
        icon: ui.add(scene.add.image(0, 0, itemTexture('knife')).setScale(ICON_SCALE)),
        caption: ui.add(
          scene.add.text(0, 0, caption, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: UI_COLORS.muted,
          }),
        ),
        empty: ui.text(0, 0, '—', UI_COLORS.muted).setOrigin(0.5),
      };
    });
    this.coinIcon = ui.add(scene.add.image(0, 0, firstFrame(ANIMATIONS.coin)).setScale(ICON_SCALE));
    this.coins = ui.text(0, 0, '').setOrigin(0, 0.5);
    this.keyIcon = ui.add(scene.add.image(0, 0, firstFrame(ANIMATIONS.key)).setScale(ICON_SCALE));
    this.stats = ui.text(0, 0, '', UI_COLORS.muted).setOrigin(0, 0.5);
    this.banner = ui.text(0, 0, '').setOrigin(0.5);

    const style = { fontFamily: 'monospace', fontSize: '14px', lineSpacing: 6 } as const;
    const rows = helpRows(backLabel);
    const intro = scene.add.text(0, 0, HELP_INTRO, { ...style, color: UI_COLORS.text });
    const keys = scene.add.text(0, intro.height + 16, rows.map(([key]) => key).join('\n'), {
      ...style,
      color: UI_COLORS.muted,
    });
    const actions = scene.add.text(
      keys.width + 24,
      keys.y,
      rows.map(([, action]) => action).join('\n'),
      { ...style, color: UI_COLORS.text },
    );
    const contentWidth = Math.max(intro.width, actions.x + actions.width);
    const contentHeight = keys.y + Math.max(keys.height, actions.height);
    const helpBack = scene.add
      .rectangle(-20, -16, contentWidth + 40, contentHeight + 32, UI_COLORS.panel, 0.96)
      .setOrigin(0)
      .setStrokeStyle(1, SLOT_COLORS.border)
      .setInteractive();
    this.help = ui.add(scene.add.container(0, 0, [helpBack, intro, keys, actions]).setDepth(20));
    this.help.setVisible(false);

    const onResize = (): void => this.layout();
    scene.scale.on('resize', onResize);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off('resize', onResize));
    this.layout();
  }

  toggleHelp(): void {
    this.help.setVisible(!this.help.visible);
  }

  get helpOpen(): boolean {
    return this.help.visible;
  }

  update(view: HudView): void {
    this.view = view;
    this.layout();
  }

  private layout(): void {
    const { width, height } = this.scene.scale;
    this.top.setSize(width, HUD_TOP);
    this.bottom.setPosition(0, height - HUD_BOTTOM).setSize(width, HUD_BOTTOM);
    this.helpHint.setX(width - PAD);
    this.prompt.setWordWrapWidth(width - 2 * PAD);
    this.log.setWordWrapWidth(width - 2 * PAD);
    const helpBounds = this.help.getBounds();
    this.help.setPosition(
      (width - helpBounds.width) / 2 + 20,
      (height - helpBounds.height) / 2 + 16,
    );

    const view = this.view;
    if (!view) return;
    this.head.setText(`${view.title} · Ход ${view.turn}`);
    this.layoutHealth(view.health, this.head.x + this.head.width + 20);
    this.prompt.setText(view.prompt);
    this.log.setText(view.log);
    this.log.setY(this.prompt.y + this.prompt.height + 4);

    const slotsY = height - HUD_BOTTOM + (HUD_BOTTOM - SLOT) / 2;
    const inventory = view.inventory;
    this.banner
      .setVisible(!inventory)
      .setText(view.banner)
      .setPosition(width / 2, height - HUD_BOTTOM / 2);
    for (const slot of this.slots) {
      for (const obj of [slot.box, slot.icon, slot.caption, slot.empty])
        obj.setVisible(!!inventory);
    }
    this.coinIcon.setVisible(!!inventory);
    this.coins.setVisible(!!inventory);
    this.keyIcon.setVisible(!!inventory && inventory.keys > 0);
    this.stats.setVisible(!!inventory);
    if (inventory) this.layoutInventory(inventory, slotsY);
  }

  private layoutHealth(health: HudHealth | null, x: number): void {
    for (const obj of [this.hpBack, this.hpFill, this.hpText]) obj.setVisible(!!health);
    if (!health) return;
    const y = this.head.y + this.head.height / 2;
    const ratio = Math.max(0, health.hp) / health.maxHp;
    this.hpBack.setPosition(x, y);
    this.hpFill
      .setPosition(x, y)
      .setSize(HP_BAR.width * ratio, HP_BAR.height)
      .setFillStyle(ratio <= LOW_HP ? HP_COLORS.low : HP_COLORS.fill);
    const who = health.name ? `${health.name}: ` : 'HP ';
    this.hpText.setText(`${who}${health.hp}/${health.maxHp}`);
    this.hpText.setPosition(x + HP_BAR.width + 8, this.head.y);
  }

  private layoutInventory(inventory: HudInventory, y: number): void {
    const items: (Item | null)[] = [
      inventory.weapon,
      inventory.armor,
      ...Array.from({ length: BACKPACK_SIZE }, (_, i) => inventory.backpack[i] ?? null),
    ];
    let x = PAD;
    this.slots.forEach((slot, index) => {
      // Руки и броня отделены от рюкзака промежутком.
      if (index === 2) x += SLOT_GAP * 2;
      const item = items[index] ?? null;
      slot.box.setPosition(x, y);
      slot.caption.setPosition(x + 3, y + 1);
      slot.icon.setPosition(x + SLOT / 2, y + SLOT / 2 + 3).setVisible(!!item);
      if (item) slot.icon.setTexture(itemTexture(item.type));
      slot.empty.setPosition(x + SLOT / 2, y + SLOT / 2 + 3).setVisible(!item);
      x += SLOT + SLOT_GAP;
    });
    const mid = y + SLOT / 2;
    x += SLOT_GAP * 2;
    this.coinIcon.setPosition(x + 8, mid);
    this.coins.setText(`${inventory.coins}`).setPosition(x + 22, mid);
    x += 22 + this.coins.width + 14;
    this.keyIcon.setPosition(x + 8, mid);
    if (inventory.keys > 0) x += 30;
    this.stats.setText(statsLine(inventory)).setPosition(x + 6, mid);
  }
}

/** Что в руках и что надето — характеристиками: «нож: урон 3 · дальн. 1 · 1 ОД  ·  кожанка −1». */
function statsLine({ weapon, armor }: HudInventory): string {
  const { damage, range, cost } = weapon ? WEAPONS[weapon.type] : UNARMED;
  const hands = `${ITEM_NAMES[weapon?.type ?? 'none']}: урон ${damage} · дальн. ${range} · ${cost} ОД`;
  const worn = armor
    ? `${ITEM_NAMES[armor.type]}: −${ARMORS[armor.type].defense} урона`
    : 'без брони';
  return `${hands}\n${worn}`;
}
