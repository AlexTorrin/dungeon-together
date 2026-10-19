// Костёр для лагеря: 4 кадра пламени над скрещёнными поленьями, лента 64×16 (спрайт-лист 16×16).
// Пересобрать: node tools/sprites/campfire.mjs [превью.png]
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { writePng } from './png.mjs';
import { ROOT, SIZE, previewOnFloor, renderSprite } from './sprite.mjs';

// R — край пламени, O — пламя, Y — сердцевина, H — полено, h — блик полена, S — камни.
// Низ (поленья и камни) общий, пламя в каждом кадре своё — языки колышутся, искры отлетают.
const LOGS = [
  '...HhOYYYOhHh...',
  '..HhhHHOOHHhhH..',
  '.SHHhhHHHHhhHHS.',
  '..SS.HH..HH.SS..',
  '................',
];

const FLAMES = [
  [
    '................',
    '................',
    '................',
    '.......R........',
    '......RR........',
    '......RRR...R...',
    '.....RRORR..R...',
    '....RROORRRRR...',
    '....RROYYORRR...',
    '....ROYYYYORR...',
    '.....OYYYYOR....',
  ],
  [
    '................',
    '................',
    '........R.......',
    '........RR......',
    '...R....RRR.....',
    '...R...RRRR.....',
    '...RR.RRORRR....',
    '....RRROORRR....',
    '....RROYYORR....',
    '....ROYYYYORR...',
    '.....OYYYYOR....',
  ],
  [
    '.......R........',
    '.......RR.......',
    '......RRR.......',
    '......RRRR......',
    '.....RRORR......',
    '.....RROORR.R...',
    '....RRROORRRR...',
    '....RROYYORRR...',
    '....ROYYYYORR...',
    '....ROYYYYYOR...',
    '.....OYYYYOR....',
  ],
  [
    '................',
    '........R.......',
    '.......RR.......',
    '..R....RRR......',
    '..RR..RRRR......',
    '...R.RRORRR.....',
    '....RRROORR.....',
    '....RROOYORR....',
    '....RROYYYORR...',
    '....ROYYYYOR....',
    '.....OYYYYOR....',
  ],
];

// Цвета пламени — с факела пака (torch_*), дерево — с оружия рыцарей, камни — с доспехов.
const COLORS = {
  R: '#bc4c51',
  O: '#d1851e',
  Y: '#ffd569',
  H: '#895a45',
  h: '#bf704d',
  S: '#90919e',
};

const frames = FLAMES.map((flame) => renderSprite([...flame, ...LOGS], COLORS));

/** Кадры 16×16 → одна лента по горизонтали. */
const strip = Buffer.alloc(SIZE * frames.length * SIZE * 4);
frames.forEach((frame, i) => {
  for (let y = 0; y < SIZE; y++) {
    const row = frame.subarray(y * SIZE * 4, (y + 1) * SIZE * 4);
    strip.set(row, (y * SIZE * frames.length + i * SIZE) * 4);
  }
});

const OUT = `${ROOT}assets/custom/campfire.png`;
writePng(OUT, SIZE * frames.length, SIZE, strip);
process.stdout.write(`${OUT}\n`);

const previewPath = process.argv[2];
if (previewPath) {
  const preview = previewOnFloor(frames[2]);
  writePng(previewPath, preview.size, preview.size, preview.data);
  process.stdout.write(`${previewPath}\n`);
}
