import { GLYPHS } from '../shared/font';
import { robotRows, type RobotState } from '../shared/robot';
import type { ShiftRow } from './shifts';

// A real PNG, built by hand, because X and most link previews can't show SVG. Pixels are written
// into an indexed bitmap and CompressionStream does the deflate, so this needs no WASM or service.
const WIDTH = 1200;
const HEIGHT = 630;

const COLORS = {
  night: [11, 16, 32],
  panel: [26, 34, 54],
  line: [47, 58, 82],
  paper: [245, 235, 216],
  ink: [11, 16, 32],
  orange: [255, 154, 60],
  red: [217, 64, 47],
  good: [95, 211, 163],
  dim: [150, 160, 180],
  steel: [174, 184, 200],
  steelMid: [124, 136, 156],
  steelDark: [74, 85, 104],
  white: [245, 241, 232],
  shirtShade: [207, 200, 184],
  hot: [255, 242, 216],
  visorDim: [90, 58, 32],
  yellow: [255, 216, 74],
  tieDark: [163, 44, 32],
  legs: [47, 58, 82],
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

const ROBOT_TO_CARD: Record<string, Color> = {
  s: 'steel', S: 'steelMid', D: 'steelDark', k: 'night', o: 'orange', O: 'hot', d: 'visorDim', x: 'red', y: 'yellow',
  w: 'white', W: 'shirtShade', r: 'red', R: 'tieDark', b: 'paper', c: 'legs',
};

function drawRobot(bitmap: Bitmap, state: RobotState, x: number, y: number, scale: number): void {
  robotRows(state).forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const color = ROBOT_TO_CARD[row[rx] as string];
      if (color) bitmap.rect(x + rx * scale, y + ry * scale, scale, scale, color);
    }
  });
}

// The room every card shares: the night office, a window, a monitor's glow.
function office(bitmap: Bitmap): void {
  bitmap.rect(0, 0, WIDTH, HEIGHT, 'night');
  bitmap.rect(0, 0, WIDTH, 12, 'orange');
  bitmap.rect(0, HEIGHT - 90, WIDTH, 90, 'panel');
  bitmap.rect(0, HEIGHT - 92, WIDTH, 3, 'line');
  bitmap.text('AGENT INTERN', 60, 46, 6, 'orange');
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
  shipped: { text: 'SHIPPED', color: 'good' },
  refused: { text: 'REFUSED', color: 'red' },
  failed: { text: 'FAILED', color: 'red' },
  'rolled-back': { text: 'ROLLED BACK', color: 'red' },
  live: { text: 'ON SHIFT', color: 'orange' },
  gate: { text: 'AT THE GATE', color: 'orange' },
};

const ROBOT_FOR: Record<string, RobotState> = { shipped: 'celebrating', refused: 'refusing', failed: 'panicking', 'rolled-back': 'panicking', live: 'working', gate: 'thinking' };
const WORK_WORD: Record<string, string> = { intern: '', rehearsal: 'REHEARSAL', team: 'TEAM CHANGE', none: 'NOT WORKED' };

export const shortWallet = (wallet: string): string => `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

function stampBox(bitmap: Bitmap, text: string, color: Color, x: number, y: number): void {
  const w = text.length * 42 + 36;
  bitmap.rect(x, y, w, 72, color);
  bitmap.rect(x + 6, y + 6, w - 12, 60, 'night');
  bitmap.text(text, x + 18, y + 15, 7, color);
}

export async function shipCard(shift: ShiftRow): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = new Bitmap();
  office(bitmap);
  bitmap.text(`SHIFT ${shift.id}`, 880, 50, 5, 'dim');
  wrap(shift.task_text, 24).slice(0, 4).forEach((line, i) => bitmap.text(line, 60, 130 + i * 74, 6, 'paper'));
  const stamp = RESULT_STAMP[shift.status] ?? { text: shift.status.toUpperCase(), color: 'dim' as Color };
  stampBox(bitmap, stamp.text, stamp.color, 60, 440);
  const version = shift.version ? `V${shift.version}` : '';
  const proposer = shift.task_team ? 'TEAM CHANGE' : shift.task_kind === 'intern' ? "INTERN'S CHOICE" : shift.proposer ? `BY ${shortWallet(shift.proposer)}` : '';
  bitmap.text([version, proposer].filter(Boolean).join('   '), 60, 566, 4, 'dim');
  const work = WORK_WORD[shift.worked_by] ?? '';
  if (work) bitmap.text(work, 760, 566, 4, 'orange');
  drawRobot(bitmap, ROBOT_FOR[shift.status] ?? 'working', 880, 150, 13);
  return encodePng(bitmap);
}

export function shipCardPost(shift: ShiftRow, origin: string): string {
  const task = shift.task_text.length > 110 ? `${shift.task_text.slice(0, 107)}...` : shift.task_text;
  const url = `${origin}/shift/${shift.id}`;
  const lead: Record<string, string> = {
    shipped: `shift ${shift.id} shipped v${shift.version ?? ''}: "${task}"`,
    refused: `shift ${shift.id}: refused "${task}"`,
    failed: `shift ${shift.id} failed: "${task}"`,
    'rolled-back': `shift ${shift.id} shipped "${task}", broke on the live site, and rolled back.`,
  };
  const who: Record<string, string> = {
    rehearsal: 'rehearsal: a person ran this to test the pipeline. the intern did not run.',
    team: 'team change, made by the people running the project with Claude Code. not intern work.',
    none: 'nobody worked this shift.',
  };
  const line = lead[shift.status] ?? `shift ${shift.id} is on: "${task}"`;
  return [line, who[shift.worked_by] ?? 'holders vote, the intern ships it.', url].join('\n');
}

export async function homeCard(): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = new Bitmap();
  bitmap.rect(0, 0, WIDTH, HEIGHT, 'night');
  bitmap.rect(0, HEIGHT - 110, WIDTH, 110, 'panel');
  bitmap.text('WE HIRED AN', 60, 90, 11, 'paper');
  bitmap.text('AI INTERN.', 60, 190, 11, 'paper');
  bitmap.text('HOLDERS ARE', 60, 310, 11, 'orange');
  bitmap.text('ITS BOSS.', 60, 410, 11, 'orange');
  bitmap.text('HOLDERS VOTE, THE INTERN SHIPS IT', 60, 556, 5, 'dim');
  drawRobot(bitmap, 'working', 800, 100, 18);
  return encodePng(bitmap);
}

export async function taskCard(id: number, text: string, votes: number): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = new Bitmap();
  office(bitmap);
  bitmap.text(`TASK ${id}`, 880, 50, 5, 'dim');
  bitmap.rect(60, 120, 800, 380, 'yellow');
  bitmap.rect(60, 120, 800, 26, 'orange');
  wrap(text, 24).slice(0, 5).forEach((line, i) => bitmap.text(line, 90, 170 + i * 62, 5, 'ink'));
  bitmap.text(`${votes} ${votes === 1 ? 'VOTE' : 'VOTES'}`, 60, 566, 4, 'orange');
  drawRobot(bitmap, 'thinking', 910, 180, 12);
  return encodePng(bitmap);
}

export async function bossCard(wallet: string, rank: string, shipped: number, votes: number): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = new Bitmap();
  office(bitmap);
  bitmap.rect(120, 130, 640, 380, 'paper');
  bitmap.rect(120, 130, 640, 70, 'red');
  bitmap.text('ID BADGE', 150, 148, 6, 'paper');
  bitmap.text(rank.toUpperCase(), 150, 240, 8, 'ink');
  bitmap.text(shortWallet(wallet), 150, 330, 5, 'ink');
  bitmap.text(`${shipped} SHIPPED  ${votes} VOTES`, 150, 410, 4, 'steelDark');
  bitmap.text('COSMETIC. NO VALUE.', 150, 460, 3, 'steelDark');
  drawRobot(bitmap, 'celebrating', 850, 170, 13);
  return encodePng(bitmap);
}

export async function dailyCard(day: number, best: number | null): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = new Bitmap();
  office(bitmap);
  bitmap.text('LAST DAY', 60, 150, 11, 'paper');
  bitmap.text('AT THE OFFICE', 60, 250, 8, 'paper');
  bitmap.text(`DAILY SHIFT #${day}`, 60, 360, 7, 'orange');
  bitmap.text(best === null ? 'NOBODY HAS CLOCKED IN' : `TOP SCORE ${best}`, 60, 450, 5, 'dim');
  bitmap.text('SAME OFFICE FOR EVERYONE', 60, 566, 4, 'dim');
  drawRobot(bitmap, 'working', 850, 150, 13);
  return encodePng(bitmap);
}
