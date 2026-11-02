import Phaser from 'phaser';
import {
  BACKPACK_SIZE,
  DEMO_ROOM,
  DIFFICULTY_LIST,
  RECONNECT_SECONDS,
  type Difficulty,
  type Room,
} from '@dt/shared';
import { TILE_SIZE, UI_COLORS, ZOOM } from '../config';
import { MapView } from '../render/mapView';
import { Lobby } from '../net/Lobby';
import { connectionError, reconnectRoom } from '../net/connection';
import { fetchProfile, profileErrorText } from '../net/profileApi';
import { forgetRoom, rememberedRoom } from '../net/resume';
import { deleteRoom, loadRooms } from '../storage/roomStorage';
import { MENU_COLORS, menuButton, menuPanel } from '../ui/menuLayout';
import { DIFFICULTY_NAMES, ITEM_NAMES } from '../ui/names';
import { TextButton, layoutRow } from '../ui/TextButton';
import { UiOverlay } from '../ui/UiOverlay';
import type { HubSceneData } from './HubScene';
import type { LobbySceneData } from './LobbyScene';
import { SCENES, type EditorSceneData, type GameSceneData } from './sceneKeys';

export class MenuScene extends Phaser.Scene {
  private difficulty: Difficulty = 'easy';
  private trainingOpen = false;
  constructor() {
    super(SCENES.menu);
  }

  create(): void {
    // Фон — демо-подземелье, притушенное полупрозрачной панелью.
    const ui = new UiOverlay(this);
    new MapView(this, DEMO_ROOM.map, (obj) => ui.world(obj));
    const camera = this.cameras.main.setZoom(ZOOM);
    camera.centerOn((DEMO_ROOM.map.width * TILE_SIZE) / 2, (DEMO_ROOM.map.height * TILE_SIZE) / 2);

    const { width, height } = this.scale;
    ui.add(
      this.add.rectangle(0, 0, width, height, UI_COLORS.panel, 0.7).setOrigin(0).setScrollFactor(0),
    );

    const gap = 16;
    const total = Math.min(880, width - 32);
    const left = (width - total) / 2;
    const wide = total >= 720;
    const col = wide ? (total - gap) / 2 : total;
    let y = 24;
    ui.text(left, y, 'ПОШАГОВОЕ ПРИКЛЮЧЕНИЕ · 1–4 ИГРОКА', MENU_COLORS.gold).setFontSize(12);
    ui.text(left, y + 26, 'Dungeon Togethere').setFontSize(width < 480 ? 25 : 36);
    ui.text(
      left,
      y + 78,
      'Спланируйте ход. Сразитесь вместе. Вернитесь с добычей.',
      UI_COLORS.muted,
    ).setWordWrapWidth(total);
    y += width < 480 ? 138 : 112;

    const resume = rememberedRoom();
    if (resume) {
      menuButton(
        this,
        ui,
        left,
        y,
        total,
        `Вернуться в игру ${resume.code}`,
        () => this.resume(resume.reconnectionToken, ui),
        true,
      );
      y += 62;
    }

    const top = y;
    menuPanel(this, ui, left, top, col, 280, '01 / В ПОДЗЕМЕЛЬЕ');
    ui.text(left + 22, top + 48, 'Одиночный забег').setFontSize(24);
    ui.text(
      left + 22,
      top + 86,
      'Случайный уровень и новая добыча.',
      UI_COLORS.muted,
    ).setWordWrapWidth(col - 44);
    const hint = ui
      .text(left + 22, top + 173, '', UI_COLORS.muted)
      .setFontSize(13)
      .setWordWrapWidth(col - 44);
    const descriptions: Record<Difficulty, string> = {
      easy: 'Для первого похода: меньше опасностей.',
      medium: 'Больше врагов. Пригодится снаряжение.',
      hard: 'Опасные противники. Подготовьтесь в лагере.',
    };
    const choices = DIFFICULTY_LIST.map((difficulty, index) => {
      const button = menuButton(
        this,
        ui,
        left + 22 + (index * (col - 44)) / 3,
        top + 124,
        (col - 44) / 3 - 6,
        DIFFICULTY_NAMES[difficulty],
        () => {
          this.difficulty = difficulty;
          refresh();
        },
      );
      return { difficulty, button };
    });
    const refresh = (): void => {
      for (const choice of choices)
        choice.button.setSelected(choice.difficulty === this.difficulty);
      hint.setText(descriptions[this.difficulty]);
    };
    refresh();
    menuButton(
      this,
      ui,
      left + 22,
      top + 204,
      col - 44,
      'Начать забег →',
      () => {
        const data: LobbySceneData = { solo: this.difficulty };
        this.scene.start(SCENES.lobby, data);
      },
      true,
    );

    const campX = wide ? left + col + gap : left;
    const campY = wide ? top : top + 296;
    menuPanel(this, ui, campX, campY, col, 280, '02 / ПОДГОТОВКА');
    ui.text(campX + 22, campY + 48, 'Ваш лагерь').setFontSize(24);
    const wallet = ui
      .text(campX + 22, campY + 88, 'Загружаем профиль…', MENU_COLORS.gold)
      .setWordWrapWidth(col - 44);
    const gear = ui
      .text(campX + 22, campY + 120, '', UI_COLORS.muted)
      .setWordWrapWidth(col - 44)
      .setLineSpacing(7);
    fetchProfile()
      .then((profile) => {
        if (!wallet.active) return;
        wallet.setText(`${profile.coins} монет · сундук: ${profile.chest.length} предм.`);
        gear.setText(
          `В руках: ${ITEM_NAMES[profile.hands ?? 'none']}\n` +
            `Броня: ${ITEM_NAMES[profile.armor ?? 'noArmor']}\n` +
            `Рюкзак: ${profile.backpack.length} / ${BACKPACK_SIZE}`,
        );
      })
      .catch((error: unknown) => {
        if (wallet.active) {
          wallet.setText('Профиль недоступен');
          gear.setText(profileErrorText(error));
        }
      });
    menuButton(this, ui, campX + 22, campY + 204, col - 44, 'В лагерь →', () => {
      const data: HubSceneData = {};
      this.scene.start(SCENES.hub, data);
    });
    y = campY + 296;
    menuPanel(this, ui, left, y, total, wide ? 130 : 224, '03 / ВМЕСТЕ ВЕСЕЛЕЕ');
    ui.text(left + 22, y + 44, 'Кооператив с друзьями')
      .setFontSize(22)
      .setWordWrapWidth(total - 44);
    ui.text(
      left + 22,
      y + 80,
      'Создайте комнату или войдите по коду. До 4 игроков.',
      UI_COLORS.muted,
    ).setWordWrapWidth(wide ? total - 330 : total - 44);
    const onlineY = wide ? y + 50 : y + 126;
    menuButton(
      this,
      ui,
      wide ? left + total - 266 : left + 22,
      onlineY,
      wide ? 244 : total - 44,
      'Сетевая игра →',
      () => {
        const data: LobbySceneData = {};
        this.scene.start(SCENES.lobby, data);
      },
    );
    y += wide ? 146 : 240;
    menuButton(
      this,
      ui,
      left,
      y,
      total,
      `${this.trainingOpen ? '−' : '+'} Тренировка и свои комнаты`,
      () => {
        this.trainingOpen = !this.trainingOpen;
        this.scene.restart();
      },
    );
    y += 60;
    if (this.trainingOpen) {
      ui.text(
        left,
        y,
        'Без снаряжения из лагеря. Добыча не сохраняется.',
        UI_COLORS.muted,
      ).setWordWrapWidth(total);
      y += 48;
      menuButton(this, ui, left, y, total, 'Демо-комната', () =>
        this.play(DEMO_ROOM, 'Демо-комната'),
      );
      y += 58;
      menuButton(this, ui, left, y, total, 'Редактор комнат', () => this.openEditor({}));
      y += 66;
      const rooms = loadRooms();
      ui.text(
        left,
        y,
        rooms.length ? 'МОИ КОМНАТЫ' : 'Сохранённых комнат пока нет',
        UI_COLORS.muted,
      );
      y += 32;
      for (const saved of rooms) {
        const name = ui.text(left, y, saved.name).setWordWrapWidth(total);
        y += name.height + 16;
        const buttons = [
          ui.add(new TextButton(this, 0, 0, 'Играть', () => this.play(saved.room, saved.name))),
          ui.add(
            new TextButton(this, 0, 0, 'Изменить', () =>
              this.openEditor({
                draft: { id: saved.id, name: saved.name, room: saved.room, dirty: false },
              }),
            ),
          ),
          ui.add(
            new TextButton(this, 0, 0, 'Удалить', () => {
              if (!window.confirm(`Удалить комнату «${saved.name}»?`)) return;
              deleteRoom(saved.id);
              this.scene.restart();
            }),
          ),
        ];
        layoutRow(buttons, left, y);
        y += 54;
      }
    }
    ui.text(left, y, '2 действия за ход · решения принимаются одновременно', UI_COLORS.muted)
      .setWordWrapWidth(total)
      .setFontSize(12);
    const maxScroll = Math.max(0, y + 64 - height);
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      ui.camera.setScroll(0, Phaser.Math.Clamp(ui.camera.scrollY + dy, 0, maxScroll));
    });
    // На сенсорном экране меню прокручивается перетаскиванием свободной области.
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && pointer.wasTouch) {
        ui.camera.setScroll(
          0,
          Phaser.Math.Clamp(
            ui.camera.scrollY + pointer.prevPosition.y - pointer.position.y,
            0,
            maxScroll,
          ),
        );
      }
    });

    const onResize = (): void => {
      this.scene.restart();
    };
    this.scale.once('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
  }

  /** После перезагрузки страницы — обратно в комнату, пока сервер держит место. */
  private resume(reconnectionToken: string, ui: UiOverlay): void {
    reconnectRoom(reconnectionToken)
      .then((room) => {
        const data: LobbySceneData = { lobby: new Lobby(room) };
        this.scene.start(SCENES.lobby, data);
      })
      .catch((error: unknown) => {
        console.warn('Вернуться не вышло', error);
        forgetRoom();
        ui.toast(
          /not found|expired|invalid/i.test(String(error))
            ? `Вернуться нельзя: место ждёт ${RECONNECT_SECONDS} с, или игра уже закончилась`
            : connectionError(error),
        );
        this.time.delayedCall(2000, () => this.scene.restart());
      });
  }

  /** Тренировка: уровень считается в браузере, профиль не трогается. */
  private play(room: Room, title: string): void {
    const data: GameSceneData = { room, title, back: { to: 'menu' } };
    this.scene.start(SCENES.game, data);
  }

  private openEditor(data: EditorSceneData): void {
    this.scene.start(SCENES.editor, data);
  }
}
