// Стены для всех сочетаний соседей — собраны из кусков тайлсета пака.
// Пересобрать: node tools/sprites/walls.mjs
//
// Битовая маска (bitmask autotiling): у стеновой клетки смотрим 8 соседей, бит = «там пол».
// Маска 0–255 однозначно задаёт, как выглядит стена, поэтому атлас — просто все маски подряд:
// кадр = маска × VARIANTS + вариант. Клиент считает ту же маску (packages/client/src/render/autotile.ts).
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { readPng, writePng } from './png.mjs';
import { ROOT, SIZE } from './sprite.mjs';

// Должно совпадать с WALL_BITS в autotile.ts.
const N = 1;
const E = 2;
const S = 4;
const W = 8;
const NE = 16;
const SE = 32;
const SW = 64;
const NW = 128;

/** Вариантов кирпичной кладки на маску — чтобы длинные стены не выглядели штампом. */
const VARIANTS = 4;
const COLUMNS = 32; // ширина атласа в тайлах: 32 × 32 × 16 px = 512 × 512

/** Кадры тайлсета пака, из которых собираем стены (по вариантам кладки). */
const PACK = {
  face: [1, 2, 3, 4], // пол снизу: видна кирпичная грань
  cap: [41, 42, 43, 44], // пол сверху: видна кромка стены, под ней тень
  bandRight: [10, 20, 30], // пол справа: полоса у правого края
  bandLeft: [15, 25, 35], // пол слева: полоса у левого края
  cornerSE: 0, // пол только по диагонали ↘: столбик у правого края
  cornerSW: 5,
  cornerNE: 40, // пол только по диагонали ↗: короткий столбик сверху справа
  cornerNW: 45,
};
const BAND = 7; // ширина полосы стены, px
const LEFT = [0, BAND - 1];
const RIGHT = [SIZE - BAND, SIZE - 1];

const VOID = [0x25, 0x13, 0x1a]; // фон сцены — «пустота» за стенами
const OUTLINE = [0x4c, 0x2f, 0x49]; // обводка стен в паке
/** Строки кромки (кадр 41), которыми заливаем верх сплошного блока — с лёгкой фактурой. */
const CAP_FILL_ROWS = [2, 3, 4, 5];

const tileset = readPng(`${ROOT}assets/character and tileset/Dungeon_Tileset.png`);

function packPixel(frame, x, y) {
  const px = (Math.floor(frame / 10) * SIZE + y) * tileset.width + (frame % 10) * SIZE + x;
  return tileset.data.subarray(px * 4, px * 4 + 4);
}

const isVoid = (p) => p[0] === VOID[0] && p[1] === VOID[1] && p[2] === VOID[2];

/** Тайл 16×16 RGBA. */
function blank() {
  const t = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) t.set([...VOID, 255], i * 4);
  return t;
}

/** Копирует кадр пака целиком. */
function copy(tile, frame) {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) tile.set(packPixel(frame, x, y), (y * SIZE + x) * 4);
}

/** Накладывает столбцы [from, to] кадра пака; пустота кадра не затирает то, что уже нарисовано. */
function overlay(tile, frame, [from, to]) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = from; x <= to; x++) {
      const p = packPixel(frame, x, y);
      if (!isVoid(p)) tile.set(p, (y * SIZE + x) * 4);
    }
  }
}

/** Пиксель пака (x, y) кадра frame в строку y тайла. */
function copyRow(tile, frame, fromY, toY) {
  for (let x = 0; x < SIZE; x++) tile.set(packPixel(frame, x, fromY), (toY * SIZE + x) * 4);
}

/** Обводка столбца x в строках [from, to]. */
function outlineColumn(tile, x, from, to) {
  for (let y = from; y <= to; y++) tile.set([...OUTLINE, 255], (y * SIZE + x) * 4);
}

/**
 * Торец стены — пол с трёх или четырёх сторон (столб, конец перегородки) — и нижний угол
 * (пол снизу и сбоку) рисуем сплошным блоком, а не полосами:
 * - пол снизу: как стена комнаты — кромка сверху и кирпичная грань;
 * - снизу продолжается стена (верхний торец вертикальной перегородки): сплошная верхняя
 *   поверхность, которая переходит в полосы перегородки ниже.
 * Стороны, где пол, закрываем обводкой, чтобы блок читался отдельным.
 */
function composeBlock(mask, v) {
  const has = (bit) => (mask & bit) !== 0;
  const tile = blank();
  const cap = PACK.cap[v % PACK.cap.length];
  let bottom = SIZE - 1;
  if (has(S)) {
    copy(tile, PACK.face[v % PACK.face.length]);
    bottom = SIZE - 2; // нижняя строка грани — тень на полу, её не обводим
  } else {
    copyRow(tile, cap, 0, 0); // верхняя обводка
    for (let y = 1; y < SIZE; y++) copyRow(tile, cap, CAP_FILL_ROWS[y % CAP_FILL_ROWS.length], y);
  }
  if (has(W)) outlineColumn(tile, 0, 0, bottom);
  if (has(E)) outlineColumn(tile, SIZE - 1, 0, bottom);
  return tile;
}

/** Как выглядит стена с полом вокруг по маске mask, вариант кладки v. */
function composeWall(mask, v) {
  const has = (bit) => (mask & bit) !== 0;
  // Торец (пол с 3–4 сторон) и угол «пол снизу и сбоку» — сплошной кирпичный блок.
  const isEnd = [N, E, S, W].filter(has).length >= 3;
  const isLowerCorner = has(S) && (has(W) || has(E));
  if (isEnd || isLowerCorner) return composeBlock(mask, v);
  const tile = blank();
  if (mask === 0) return tile; // глухая стена — пустота

  // 1. Основа — по северу и югу. Пол снизу — всегда кирпичная грань, в том числе у
  //    горизонтальной перегородки (пол и сверху, и снизу): так она выглядит сплошной стеной,
  //    как стена комнаты, и сходится с торцами-блоками. Тонкую кромку пака (51–54) не берём.
  if (has(S)) copy(tile, PACK.face[v % PACK.face.length]);
  else if (has(N)) copy(tile, PACK.cap[v % PACK.cap.length]);

  // 2. Углы: пол только по диагонали, обе соседние прямые клетки — стены.
  if (has(SE) && !has(S) && !has(E)) overlay(tile, PACK.cornerSE, RIGHT);
  if (has(SW) && !has(S) && !has(W)) overlay(tile, PACK.cornerSW, LEFT);
  if (has(NE) && !has(N) && !has(E)) overlay(tile, PACK.cornerNE, RIGHT);
  if (has(NW) && !has(N) && !has(W)) overlay(tile, PACK.cornerNW, LEFT);

  // 3. Боковые полосы. Пол с обеих сторон — две полосы спина к спине (середина перегородки;
  //    её торцы — сплошные блоки, см. composeBlock).
  if (has(W)) overlay(tile, PACK.bandLeft[v % PACK.bandLeft.length], LEFT);
  if (has(E)) overlay(tile, PACK.bandRight[v % PACK.bandRight.length], RIGHT);
  return tile;
}

/**
 * Самопроверка: в обычных случаях сборка обязана дать ровно тот же тайл, что нарисован в паке
 * (горизонтальная перегородка — намеренно как верхняя стена комнаты, а не тайл 51).
 * Если правило сборки сломается, генератор упадёт, а не тихо испортит все стены.
 */
function selfCheck() {
  const cases = [
    ['верхняя стена', S | SE | SW, PACK.face],
    ['нижняя стена', N | NE | NW, PACK.cap],
    ['горизонтальная перегородка', N | S | NE | NW | SE | SW, PACK.face],
    ['левая стена', E | NE | SE, PACK.bandRight],
    ['правая стена', W | NW | SW, PACK.bandLeft],
    ['угол ↖', SE, [PACK.cornerSE]],
    ['угол ↗', SW, [PACK.cornerSW]],
  ];
  for (const [name, mask, frames] of cases) {
    for (let v = 0; v < VARIANTS; v++) {
      const expected = blank();
      copy(expected, frames[v % frames.length]);
      if (!composeWall(mask, v).equals(expected)) {
        throw new Error(`Сборка «${name}» (маска ${mask}, вариант ${v}) не совпала с тайлом пака`);
      }
    }
  }
}

selfCheck();

const count = 256 * VARIANTS;
const width = COLUMNS * SIZE;
const height = Math.ceil(count / COLUMNS) * SIZE;
const atlas = Buffer.alloc(width * height * 4);
for (let frame = 0; frame < count; frame++) {
  const tile = composeWall(Math.floor(frame / VARIANTS), frame % VARIANTS);
  const ox = (frame % COLUMNS) * SIZE;
  const oy = Math.floor(frame / COLUMNS) * SIZE;
  for (let y = 0; y < SIZE; y++)
    tile.copy(atlas, ((oy + y) * width + ox) * 4, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const OUT = `${ROOT}assets/custom/walls.png`;
writePng(OUT, width, height, atlas);
process.stdout.write(`${OUT}\n`);
