// Минимальный PNG без зависимостей: чтение (8 бит на канал, без interlace) и запись RGBA.
// Пиксели — Buffer длиной width * height * 4, построчно, RGBA.
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Байт на пиксель для типов цвета PNG: 0 — серый, 2 — RGB, 3 — палитра, 4 — серый+альфа, 6 — RGBA. */
const BYTES_PER_PIXEL = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** @returns {{ width: number, height: number, data: Buffer }} */
export function readPng(path) {
  const buf = readFileSync(path);
  let width = 0;
  let height = 0;
  let colorType = 0;
  const palette = [];
  let alphas = [];
  const idat = [];
  for (let pos = SIGNATURE.length; pos < buf.length;) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8) throw new Error(`${path}: only 8-bit PNG supported`);
      if (data[12] !== 0) throw new Error(`${path}: interlaced PNG not supported`);
    } else if (type === 'PLTE') {
      for (let i = 0; i < len; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === 'tRNS') {
      alphas = [...data];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + len;
  }

  const bpp = BYTES_PER_PIXEL[colorType];
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    unfilter(line, prev, filter, bpp);
    for (let x = 0; x < width; x++)
      out.set(pixel(line, x * bpp, colorType, palette, alphas), (y * width + x) * 4);
    prev = line;
  }
  return { width, height, data: out };
}

/** Снимает фильтр строки PNG (None, Sub, Up, Average, Paeth). */
function unfilter(line, prev, filter, bpp) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    line[i] = (line[i] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
  }
}

function pixel(line, s, colorType, palette, alphas) {
  switch (colorType) {
    case 6:
      return [line[s], line[s + 1], line[s + 2], line[s + 3]];
    case 2:
      return [line[s], line[s + 1], line[s + 2], 255];
    case 3:
      return [...palette[line[s]], alphas[line[s]] ?? 255];
    case 4:
      return [line[s], line[s], line[s], line[s + 1]];
    default:
      return [line[s], line[s], line[s], 255];
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function writePng(path, width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // бит на канал
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height); // фильтр 0 (None) в начале каждой строки
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  writeFileSync(
    path,
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
