// Нож — оружие ближнего боя. Пересобрать: node tools/sprites/knife.mjs [превью.png]
import process from 'node:process';
import { writePng } from './png.mjs';
import { ROOT, SIZE, previewOnFloor, renderSprite } from './sprite.mjs';

// L — блик клинка, M — тень клинка, G — гарда, H — рукоять, h — блик рукояти, P — навершие.
const ART = [
  '................',
  '................',
  '................',
  '................',
  '...........L....',
  '..........LM....',
  '.........LM.....',
  '........LM......',
  '.....G.LM.......',
  '......G.........',
  '....hH.G........',
  '...hH...........',
  '...H............',
  '..P.............',
  '................',
  '................',
];

// Только цвета из пака: металл — с доспехов рыцарей, дерево — с их оружия.
const COLORS = {
  L: '#adc1cf',
  M: '#90919e',
  G: '#90919e',
  H: '#895a45',
  h: '#bf704d',
  P: '#373737',
};

const OUT = `${ROOT}assets/custom/knife.png`;
const sprite = renderSprite(ART, COLORS);
writePng(OUT, SIZE, SIZE, sprite);
process.stdout.write(`${OUT}\n`);

const previewPath = process.argv[2];
if (previewPath) {
  const preview = previewOnFloor(sprite);
  writePng(previewPath, preview.size, preview.size, preview.data);
  process.stdout.write(`${previewPath}\n`);
}
