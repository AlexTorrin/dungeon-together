// Открывает игру в headless Chromium, выполняет шаги из argv, делает финальный скриншот.
// Использование: node shot.mjs <out.png> [step ...]
// Шаги:
//   ArrowRight / KeyD / Escape ...  — нажать клавишу
//   hold:KeyD:600                    — держать клавишу N мс
//   down:KeyW  up:KeyW               — зажать / отпустить (для сочетаний: down:KeyW KeyA up:KeyW)
//   move:x,y                         — навести мышь (без клика)
//   click:x,y   rclick:x,y           — клик ЛКМ/ПКМ в экранных координатах (вьюпорт 960×640)
//   drag:x1,y1:x2,y2                 — провести зажатой ЛКМ
//   clicktext:Текст                  — клик по центру надписи на канвасе (ищется через Phaser)
//   wait:ms                          — пауза
//   shot:/path.png                   — промежуточный скриншот
//   dialog:текст                     — ответ на следующий window.prompt (confirm → accept)
import { chromium } from 'playwright';

const [out, ...steps] = process.argv.slice(2);
if (!out) {
  console.error('Usage: node shot.mjs <out.png> [Key ...]');
  process.exit(2);
}
const url = process.env.GAME_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

await page.goto(url);
await page.waitForSelector('#game canvas', { timeout: 15000 });
await page.waitForTimeout(1500); // загрузка ассетов + первые кадры анимации
let dialogAnswer = '';
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(dialogAnswer) : d.accept()));

const xy = (s) => s.split(',').map(Number);
for (const raw of steps) {
  const [cmd, ...rest] = raw.split(':');
  const arg = rest.join(':');
  if (cmd === 'hold') {
    const [key, ms] = [rest[0], Number(rest[1] ?? 500)];
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  } else if (cmd === 'down' || cmd === 'up') {
    await page.keyboard[cmd](arg);
  } else if (cmd === 'move') {
    const [x, y] = xy(arg);
    await page.mouse.move(x, y);
  } else if (cmd === 'click' || cmd === 'rclick') {
    const [x, y] = xy(arg);
    await page.mouse.click(x, y, { button: cmd === 'rclick' ? 'right' : 'left' });
  } else if (cmd === 'drag') {
    const [[x1, y1], [x2, y2]] = rest.map(xy);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 20 });
    await page.mouse.up();
  } else if (cmd === 'clicktext') {
    const pos = await page.evaluate((text) => {
      for (const scene of window.__game?.scene.getScenes(true) ?? []) {
        const hit = scene.children.list.find((o) => o.type === 'Text' && o.text.includes(text));
        if (hit) {
          const b = hit.getBounds();
          return { x: b.centerX, y: b.centerY };
        }
      }
      return null;
    }, arg);
    if (!pos) throw new Error(`clicktext: '${arg}' not found (нужен window.__game в dev-сборке)`);
    await page.mouse.click(pos.x, pos.y);
  } else if (cmd === 'wait') {
    await page.waitForTimeout(Number(arg));
  } else if (cmd === 'shot') {
    await page.screenshot({ path: arg });
  } else if (cmd === 'dialog') {
    dialogAnswer = arg;
  } else {
    await page.keyboard.press(raw);
  }
  await page.waitForTimeout(300);
}
const png = await page.screenshot({ path: out });

// Грубая проверка «не пустой ли кадр»: считаем различные цвета на самом скриншоте
// (WebGL-канвас Phaser напрямую не читается — буфер очищается после кадра).
const colors = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return set.size;
}, png.toString('base64'));
if (colors < 8) problems.push(`blank frame? only ${colors} distinct colors`);

await browser.close();
console.log(`screenshot: ${out} (${png.length} bytes, ${colors} colors)`);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log('OK: no errors');
