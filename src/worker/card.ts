import { GLYPHS } from '../shared/font';
import type { ShiftRow } from './shifts';

// A real PNG, built by hand, because X and most link previews can't show SVG. Pixels are written
// into an indexed bitmap and CompressionStream does the deflate, so this needs no WASM or service.
const WIDTH = 1200;
const HEIGHT = 630;

const COLORS = {
  paper: [245, 237, 216],
  rule: [216, 205, 178],
  ink: [28, 26, 38],
  red: [217, 64, 47],
  blue: [58, 74, 120],
  yellow: [255, 216, 74],
  white: [255, 253, 246],
  skin: [242, 194, 155],
  hair: [74, 47, 34],
  green: [47, 138, 96],
  dim: [120, 112, 96],
} as const;
type Color = keyof typeof COLORS;
const INDEX = Object.fromEntries(Object.keys(COLORS).map((name, i) => [name, i])) as Record<Color, number>;

class Bitmap {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT);

  rect(x: number, y: number, w: number, h: number, color: Color): void {
    const value = INDEX[color];
    for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + h); row++) {
      this.pixels.fill(value, row * WIDTH + Math.max(0, x), row * WIDTH + Math.min(WIDTH, x + w));
    }
  }

  text(text: string, x: number, y: number, scale: number, color: Color): void {
    let at = x;
    for (const char of text.toUpperCase()) {
      const rows = GLYPHS[char] ?? (char === ' ' ? null : GLYPHS['?']);
      if (rows) {
        rows.forEach((bits, row) => {
          for (let col = 0; col < 5; col++) {
            if (bits & (1 << (4 - col))) this.rect(at + col * scale, y + row * scale, scale, scale, color);
          }
        });
      }
      at += 6 * scale;
    }
  }
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const INTERN = [
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.hssssssh.',
  '.sksssksss',
  '.ssssssss.',
  '..sssss...',
  '.wwwrrwww.',
  'swwwrrwwws',
  'swwwrrwwws',
  '.wwwrrwww.',
  '.bbbbbbbb.',
  '.bb....bb.',
];
const INTERN_COLORS: Record<string, Color> = { h: 'hair', s: 'skin', k: 'ink', w: 'white', r: 'red', b: 'blue' };

function drawIntern(bitmap: Bitmap, x: number, y: number, scale: number): void {
  INTERN.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const color = INTERN_COLORS[row[rx] as string];
      if (color) bitmap.rect(x + rx * scale, y + ry * scale, scale, scale, color);
    }
  });
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodePng(bitmap: Bitmap): Promise<Uint8Array<ArrayBuffer>> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, WIDTH);
  view.setUint32(4, HEIGHT);
  header[8] = 8;
  header[9] = 3;

  const palette = new Uint8Array(Object.values(COLORS).flat());
  const raw = new Uint8Array((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    raw.set(bitmap.pixels.subarray(y * WIDTH, (y + 1) * WIDTH), y * (WIDTH + 1) + 1);
  }

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', palette),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

const RESULT_STAMP: Record<string, { text: string; color: Color }> = {
  shipped: { text: 'SHIPPED', color: 'green' },
  refused: { text: 'REFUSED', color: 'red' },
  failed: { text: 'FAILED', color: 'red' },
  'rolled-back': { text: 'ROLLED BACK', color: 'red' },
  live: { text: 'ON SHIFT', color: 'blue' },
  gate: { text: 'AT THE GATE', color: 'blue' },
};

export const shortWallet = (wallet: string): string => `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

export async function shipCard(shift: ShiftRow): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = new Bitmap();
  bitmap.rect(0, 0, WIDTH, HEIGHT, 'paper');
  for (let y = 110; y < HEIGHT; y += 52) bitmap.rect(0, y, WIDTH, 2, 'rule');
  bitmap.rect(84, 0, 3, HEIGHT, 'red');

  bitmap.text('AGENT INTERN', 120, 40, 6, 'ink');
  bitmap.text(`SHIFT ${shift.id}`, 880, 46, 5, 'red');

  const lines = wrap(shift.task_text, 26).slice(0, 4);
  lines.forEach((line, i) => bitmap.text(line, 120, 140 + i * 80, 6, 'ink'));

  const stamp = RESULT_STAMP[shift.status] ?? { text: shift.status.toUpperCase(), color: 'ink' as Color };
  const stampW = stamp.text.length * 42 + 36;
  const stampY = 472;
  bitmap.rect(120, stampY, stampW, 72, stamp.color);
  bitmap.rect(126, stampY + 6, stampW - 12, 60, 'paper');
  bitmap.text(stamp.text, 138, stampY + 15, 7, stamp.color);

  const version = shift.version ? `V${shift.version}` : '';
  const proposer = shift.task_kind === 'intern' ? "INTERN'S CHOICE" : shift.proposer ? `BY ${shortWallet(shift.proposer)}` : '';
  bitmap.text([version, proposer].filter(Boolean).join('   '), 120, 566, 4, 'dim');
  if (shift.rehearsal) bitmap.text('REHEARSAL', 900, 566, 4, 'red');

  drawIntern(bitmap, 960, 360, 18);
  return encodePng(bitmap);
}

export async function homeCard(): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = new Bitmap();
  bitmap.rect(0, 0, WIDTH, HEIGHT, 'paper');
  for (let y = 110; y < HEIGHT; y += 52) bitmap.rect(0, y, WIDTH, 2, 'rule');
  bitmap.rect(84, 0, 3, HEIGHT, 'red');
  bitmap.text('WE HIRED AN', 120, 100, 11, 'ink');
  bitmap.text('AI INTERN.', 120, 200, 11, 'ink');
  bitmap.text('HOLDERS ARE', 120, 320, 11, 'red');
  bitmap.text('ITS BOSS.', 120, 420, 11, 'red');
  bitmap.text('HOLDERS VOTE, THE INTERN SHIPS IT', 120, 546, 5, 'dim');
  drawIntern(bitmap, 930, 200, 20);
  return encodePng(bitmap);
}
