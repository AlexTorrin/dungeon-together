export const TILE_SIZE = 16;
export const ZOOM = 3;
export const BACKGROUND_COLOR = '#25131a';

/** Сколько длится анимация шага героя; пока она идёт, следующая команда не отправляется. */
export const MOVE_DURATION_MS = 130;
export const BUMP_DURATION_MS = 90;

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
