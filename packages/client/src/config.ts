export const TILE_SIZE = 16;
export const ZOOM = 3;
export const BACKGROUND_COLOR = '#25131a';

/** Сколько длится анимация шага героя; пока она идёт, следующая команда не отправляется. */
export const MOVE_DURATION_MS = 130;
export const BUMP_DURATION_MS = 90;
/** Сколько всплывает цифра урона. */
export const DAMAGE_FLOAT_MS = 600;

/** Порядок отрисовки мира (depth): что поверх чего. */
export const DEPTH = {
  fog: 0.05, // туман войны: поверх карты и факелов, под предметами и акторами (их прячем сами)
  items: 0.1,
  intents: 0.2,
  actors: 0.5,
  overlays: 1, // полоски HP, отметки «готов»
  floaters: 2, // цифры урона
} as const;

/** Цвета намерений и подсветки (0xRRGGBB для Graphics). */
export const INTENT_COLORS = {
  me: 0xf4e3c1,
  ally: 0x7ec8e3,
  attack: 0xe0503a,
  reach: 0xe0503a,
  hover: 0xffffff,
  cursor: 0xffd27f,
  cursorBlocked: 0x8a7a80,
} as const;

export const EDITOR = {
  defaultWidth: 16,
  defaultHeight: 12,
  minSize: 3,
  maxSize: 64,
} as const;

export const UI_COLORS = {
  text: '#f4e3c1',
  muted: '#b89a8c',
  button: '#3b2433',
  buttonHover: '#5a3550',
  buttonSelected: '#8a4b2f',
  panel: 0x1a0d13,
} as const;
