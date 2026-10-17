// Дверь-выход: закрытая (доски с оковкой) и открытая (тёмный проём) — в каменной раме.
// Пересобрать: node tools/sprites/door.mjs [папка-для-превью]
import process from 'node:process';
import { writePng } from './png.mjs';
import { ROOT, SIZE, previewOnFloor, renderSprite } from './sprite.mjs';

// F — рама (камень стены), f — тень рамы, D — доски, d — щели между досками,
// I — оковка и кольцо, O — тьма за открытой дверью.
const CLOSED = [
  'FFFFFFFFFFFFFFFF',
  'FffffffffffffffF',
  'Ff.DDdDDdDDdDD.F',
  'FfDDDdDDdDDdDDDF',
  'FfDDDdDDdDDdDDDF',
  'FfIIIIIIIIIIIIIF',
  'FfDDDdDDdDDdDDDF',
  'FfDDDdDDdDDdIDDF',
  'FfDDDdDDdDDIdIDF',
  'FfDDDdDDdDDdIDDF',
  'FfDDDdDDdDDdDDDF',
  'FfIIIIIIIIIIIIIF',
  'FfDDDdDDdDDdDDDF',
  'FfDDDdDDdDDdDDDF',
  'FfDDDdDDdDDdDDDF',
  'FfDDDdDDdDDdDDDF',
];
const OPEN = [
  'FFFFFFFFFFFFFFFF',
  'FffffffffffffffF',
  'Ff.OOOOOOOOOOO.F',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
  'FfOOOOOOOOOOOOOF',
];

// Только цвета из пака: камень и тени стен, дерево и металл с оружия рыцарей.
const COLORS = {
  F: '#78514f',
  f: '#4c2f49',
  D: '#895a45',
  d: '#593756',
  I: '#90919e',
  O: '#25131a',
};

const previewDir = process.argv[2];
for (const [name, art] of [
  ['door_closed', CLOSED],
  ['door_open', OPEN],
]) {
  const out = `${ROOT}assets/custom/${name}.png`;
  const sprite = renderSprite(art, COLORS);
  writePng(out, SIZE, SIZE, sprite);
  process.stdout.write(`${out}\n`);
  if (previewDir) {
    const preview = previewOnFloor(sprite);
    writePng(`${previewDir}/${name}.png`, preview.size, preview.size, preview.data);
  }
}
