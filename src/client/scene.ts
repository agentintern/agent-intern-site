import { GLYPHS } from '../shared/font';
import { ROBOT_COLORS, ROBOT_WIDTH, robotRows, type RobotState } from '../shared/robot';
import { byId, reducedMotion } from './dom';

// The office at night, painted in code. Everything it shows comes from the data attributes the server
// wrote: the robot's mood, the promotion level, the close time and the latest real commit.
const W = 320;
const H = 150;

interface Drop { x: number; y: number; v: number }

let ctx: CanvasRenderingContext2D | null = null;
let host: HTMLElement | null = null;
let visible = true;
let frame = 0;
let last = 0;
const rain: Drop[] = [];
const windows = Array.from({ length: 34 }, (_, i) => ({ x: 8 + ((i * 41) % 116), y: 44 + ((i * 17) % 40), lit: i % 3 !== 0 }));

const rect = (x: number, y: number, w: number, h: number, c: string): void => {
  if (!ctx) return;
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};

// The project's bitmap font, so text stays as crisp as the art at this size.
function text(value: string, x: number, y: number, c: string, clipLeft = 0, clipRight = W): void {
  let at = x;
  for (const char of value.toUpperCase()) {
    const rows = GLYPHS[char];
    if (rows && at > clipLeft - 6 && at < clipRight) {
      rows.forEach((bits, row) => {
        for (let col = 0; col < 5; col++) {
          const px = at + col;
          if (bits & (1 << (4 - col)) && px >= clipLeft && px < clipRight) rect(px, y + row, 1, 1, c);
        }
      });
    }
    at += 6;
  }
}

function drawRoom(on: boolean, level: number): void {
  rect(0, 0, W, H, on ? '#141c32' : '#0b1020');
  // The window, the skyline and the rain.
  rect(6, 8, 124, 86, '#2f3a52');
  rect(8, 10, 120, 82, '#0d1430');
  rect(8, 64, 26, 28, '#121a38');
  rect(34, 50, 22, 42, '#101836');
  rect(56, 58, 30, 34, '#121a38');
  rect(86, 44, 20, 48, '#101836');
  rect(106, 62, 22, 30, '#121a38');
  for (const w of windows) if (w.lit) rect(w.x, w.y, 2, 2, frame % 240 < 200 || w.x % 3 ? '#ffb054' : '#5a3a20');
  for (const d of rain) rect(d.x, d.y, 1, 3, '#3a4a78');
  rect(66, 8, 3, 86, '#2f3a52');
  // Floor and lamp light.
  rect(0, 112, W, 38, on ? '#1f2a44' : '#141c32');
  rect(0, 111, W, 2, '#2f3a52');
  if (on) {
    rect(0, 0, W, 4, '#ffd27a');
    ctx && (ctx.globalAlpha = 0.08);
    rect(0, 0, W, H, '#ff9a3c');
    ctx && (ctx.globalAlpha = 1);
  }
  if (level >= 1) {
    rect(296, 92, 12, 20, '#7a4a2e');
    rect(291, 74, 22, 20, '#2f7a55');
  }
}

function drawClock(closes: number): void {
  rect(140, 12, 62, 26, '#1a2236');
  rect(142, 14, 58, 22, '#05070f');
  const total = Math.max(0, Math.floor((closes - Date.now()) / 1000));
  const value = `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  text(value, 147, 21, '#ff9a3c');
}

function drawDesk(commit: string, state: RobotState, level: number): void {
  rect(150, 104, 150, 7, '#6b4a30');
  rect(150, 111, 150, 3, '#4d3524');
  rect(158, 114, 5, 26, '#4d3524');
  rect(287, 114, 5, 26, '#4d3524');
  // The CRT shows the latest real commit, scrolling.
  rect(216, 62, 72, 44, '#2a3346');
  rect(219, 65, 66, 34, state === 'panicking' && frame % 20 < 10 ? '#4a1410' : '#07110c');
  const span = commit.length * 6 + 66;
  const offset = Math.floor(frame / 2) % span;
  text(commit, 285 - offset, 79, '#7cffb2', 219, 285);
  rect(246, 106, 12, 3, '#2a3346');
  if (level >= 2) {
    rect(296, 72, 20, 32, '#2a3346');
    rect(298, 74, 16, 22, '#07110c');
  }
}

function drawRobot(state: RobotState): void {
  // A chair behind, and the robot sits at the desk, so its legs stay out of sight.
  rect(166, 64, 48, 44, '#2a3346');
  rect(170, 68, 40, 36, '#1f2a44');
  const rows = robotRows(state).slice(0, 20);
  const x0 = 170;
  const breathing = state === 'working' && frame % 16 < 8 ? 1 : 0;
  const y0 = 64 - breathing;
  rows.forEach((row, y) => {
    for (let x = 0; x < ROBOT_WIDTH; x++) {
      const color = ROBOT_COLORS[row[x] as string];
      if (color) rect(x0 + x * 2, y0 + y * 2, 2, 2, color);
    }
  });
  if (state === 'asleep') text(frame % 80 < 40 ? 'Z' : 'ZZ', 214, 48, '#aeb8c8');
  if (state === 'stuck') text('?', 214, 50, '#ffd84a');
  if (state === 'celebrating') {
    for (let i = 0; i < 16; i++) rect((i * 37 + frame) % W, (i * 23 + frame) % H, 2, 3, ['#ff9a3c', '#ffd84a', '#d9402f'][i % 3] as string);
  }
}

function paint(): void {
  if (!ctx || !host) return;
  const d = host.dataset;
  const state = (d.state ?? 'asleep') as RobotState;
  const level = Number(d.level ?? 0);
  drawRoom(d.on === '1', level);
  drawClock(Number(d.closes ?? 0));
  drawRobot(state);
  drawDesk(d.commit ?? '', state, level);
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  if (!visible || document.hidden || now - last < 66) return;
  last = now;
  frame++;
  for (const d of rain) {
    d.y += d.v;
    if (d.y > 90) { d.y = 10; d.x = 8 + Math.random() * 118; }
  }
  paint();
}

export function syncScene(): void {
  paint();
}

export function startScene(): void {
  host = byId('scene');
  if (!host) return;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `The office at night. The robot intern is ${host.dataset.state ?? 'asleep'}.`);
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < 40; i++) rain.push({ x: 8 + Math.random() * 118, y: 10 + Math.random() * 80, v: 2 + Math.random() * 2 });
  host.append(canvas);
  host.classList.add('painted');
  paint();
  new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); }).observe(host);
  if (reducedMotion()) {
    setInterval(paint, 1000);
    return;
  }
  requestAnimationFrame(loop);
}
