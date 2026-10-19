// Кольчуга — защита 2. Пересобрать: node tools/sprites/mail.mjs [превью.png]
import process from 'node:process';
import { writePng } from './png.mjs';
import { ROOT, SIZE, previewOnFloor, renderSprite } from './sprite.mjs';

// L — блик колец, M — кольца, P — тень, H — кожаный ворот и подол.
const ART = [
  '................',
  '................',
  '................',
  '...HHH....HHH...',
  '..PLMLH..HLMLP..',
  '..PMLMLHHMLMLP..',
  '..PLMLMLMLMLMP..',
  '..PPLMLMLMLMPP..',
  '....PMLMLMLP....',
  '....PLMLMLMP....',
  '....PMLMLMLP....',
  '....PLMLMLMP....',
  '....PMLMLMLP....',
  '....HHHHHHHH....',
  '................',
  '................',
];

// Только цвета из пака (см. docs/assets.md, «Свои спрайты»).
const COLORS = {
  L: '#adc1cf',
  M: '#90919e',
  P: '#373737',
  H: '#895a45',
};

const OUT = `${ROOT}assets/custom/mail.png`;
const sprite = renderSprite(ART, COLORS);
writePng(OUT, SIZE, SIZE, sprite);
process.stdout.write(`${OUT}\n`);

const previewPath = process.argv[2];
if (previewPath) {
  const preview = previewOnFloor(sprite);
  writePng(previewPath, preview.size, preview.size, preview.data);
  process.stdout.write(`${previewPath}\n`);
}
