// Волшебная палочка — дальний удар на 6 клеток. Пересобрать: node tools/sprites/wand.mjs [превью.png]
import process from 'node:process';
import { writePng } from './png.mjs';
import { ROOT, SIZE, previewOnFloor, renderSprite } from './sprite.mjs';

// H — древко, h — блик древка, P — наконечник, R — камень, r — тень камня, W — блик камня.
const ART = [
  '................',
  '................',
  '................',
  '................',
  '...........RW...',
  '...........rR...',
  '.........hH.....',
  '.........H......',
  '.......hH.......',
  '.......H........',
  '.....hH.........',
  '.....H..........',
  '....H...........',
  '...P............',
  '................',
  '................',
];

// Только цвета из пака (см. docs/assets.md, «Свои спрайты»).
const COLORS = {
  H: '#895a45',
  h: '#bf704d',
  P: '#373737',
  R: '#cf686d',
  r: '#bc4c51',
  W: '#adc1cf',
};

const OUT = `${ROOT}assets/custom/wand.png`;
const sprite = renderSprite(ART, COLORS);
writePng(OUT, SIZE, SIZE, sprite);
process.stdout.write(`${OUT}\n`);

const previewPath = process.argv[2];
if (previewPath) {
  const preview = previewOnFloor(sprite);
  writePng(previewPath, preview.size, preview.size, preview.data);
  process.stdout.write(`${previewPath}\n`);
}
