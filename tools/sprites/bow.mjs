// Лук — дальний удар на 4 клетки. Пересобрать: node tools/sprites/bow.mjs [превью.png]
import process from 'node:process';
import { writePng } from './png.mjs';
import { ROOT, SIZE, previewOnFloor, renderSprite } from './sprite.mjs';

// H — дуга, h — блик дуги, P — рукоять, S — тетива.
const ART = [
  '................',
  '................',
  '................',
  '............H...',
  '...........SH...',
  '..........S.h...',
  '.........S..H...',
  '........S...H...',
  '.......S...H....',
  '......S....P....',
  '.....S....P.....',
  '....S...HP......',
  '...HHhHH........',
  '................',
  '................',
  '................',
];

// Только цвета из пака (см. docs/assets.md, «Свои спрайты»).
const COLORS = {
  H: '#895a45',
  h: '#bf704d',
  P: '#373737',
  S: '#adc1cf',
};

const OUT = `${ROOT}assets/custom/bow.png`;
const sprite = renderSprite(ART, COLORS);
writePng(OUT, SIZE, SIZE, sprite);
process.stdout.write(`${OUT}\n`);

const previewPath = process.argv[2];
if (previewPath) {
  const preview = previewOnFloor(sprite);
  writePng(previewPath, preview.size, preview.size, preview.data);
  process.stdout.write(`${previewPath}\n`);
}
