/** Параметры генерации уровня (generateLevel). */
export const LEVEL = {
  width: 40,
  height: 28,
  /** Комнаты генератора Digger: ширина и высота пола, [мин, макс]. */
  roomWidth: [4, 9],
  roomHeight: [3, 7],
  corridorLength: [2, 6],
  /** Какую долю карты прокопать, прежде чем остановиться. */
  dugPercentage: 0.3,
  monsters: 6,
  items: 4,
} as const;
