// Кожаная броня — защита 1. Пересобрать: node tools/sprites/leather.mjs [превью.png]
import process from 'node:process';
import { writePng } from './png.mjs';
import { ROOT, SIZE, previewOnFloor, renderSprite } from './sprite.mjs';

// H — тень кожи, h — кожа, B — ремень, G — пряжка.
const ART = [
  '................',
  '................',
  '................',
  '...HHH....HHH...',
  '..HhhhH..HhhhH..',
  '..HhhhhHHhhhhH..',
  '..HhhhhhhhhhhH..',
  '..HHhhhhhhhhHH..',
  '...HhhhhhhhhH...',
  '...HhhhhhhhhH...',
  '...BBBBGGBBBB...',
  '...HhhhhhhhhH...',
  '...HhhhhhhhhH...',
  '...HHHHHHHHHH...',
  '................',
  '................',
];

// Только цвета из пака (см. docs/assets.md, «Свои спрайты»).
const COLORS = {
  H: '#895a45',
  h: '#bf704d',
  B: '#4c2f49',
  G: '#adc1cf',
};

const OUT = `${ROOT}assets/custom/leather.png`;
const sprite = renderSprite(ART, COLORS);
writePng(OUT, SIZE, SIZE, sprite);
process.stdout.write(`${OUT}\n`);

const previewPath = process.argv[2];
if (previewPath) {
  const preview = previewOnFloor(sprite);
  writePng(previewPath, preview.size, preview.size, preview.data);
  process.stdout.write(`${previewPath}\n`);
}
