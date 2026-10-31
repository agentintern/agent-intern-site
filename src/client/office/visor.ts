import { CanvasTexture, SRGBColorSpace } from 'three';
import { GLYPHS } from '../../shared/font';

const WIDTH = 640;
const HEIGHT = 186;
const EYE_WIDTH = 214;
const EYE_HEIGHT = 74;

interface Tint { edge: string; core: string; hot: string }
const ORANGE: Tint = { edge: '#ff7a1c', core: '#ffb054', hot: '#fff2d8' };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2));
}

// One eye from the PFP: a rounded slit, orange at the edge and white-hot through the middle.
function paintEye(tint: Tint): HTMLCanvasElement {
  const margin = 44;
  const canvas = document.createElement('canvas');
  canvas.width = EYE_WIDTH + margin * 2;
  canvas.height = EYE_HEIGHT + margin * 2;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.shadowColor = tint.edge;
  ctx.shadowBlur = 34;
  ctx.fillStyle = tint.edge;
  roundRect(ctx, margin, margin, EYE_WIDTH, EYE_HEIGHT, 26);
  ctx.fill();
  ctx.shadowBlur = 14;
  ctx.shadowColor = tint.core;
  ctx.fillStyle = tint.core;
  roundRect(ctx, margin + 7, margin + 7, EYE_WIDTH - 14, EYE_HEIGHT - 14, 20);
  ctx.fill();
  ctx.shadowBlur = 10;
  ctx.shadowColor = tint.hot;
  ctx.fillStyle = tint.hot;
  roundRect(ctx, margin + 28, margin + 24, EYE_WIDTH - 56, EYE_HEIGHT - 48, 12);
  ctx.fill();
  return canvas;
}

// The screen in the visor. It only redraws when something on it changes, so a still robot costs no uploads.
export class VisorScreen {
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly eye = paintEye(ORANGE);
  private drawn = '';

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  // Our bitmap font, so anything the visor says matches the rest of the site.
  private text(value: string, centerX: number, y: number, scale: number, color: string): void {
    const chars = value.toUpperCase();
    let x = centerX - (chars.length * 6 * scale) / 2;
    this.ctx.fillStyle = color;
    for (const char of chars) {
      GLYPHS[char]?.forEach((bits, row) => {
        for (let col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) this.ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
        }
      });
      x += 6 * scale;
    }
  }

  // open: 1 is a full eye and 0 a shut one. look: -1 to 1, how far the eyes have moved across the screen.
  draw(open: number, look = 0, line = ''): void {
    const state = `${open.toFixed(2)}|${look.toFixed(2)}|${line}`;
    if (state === this.drawn) return;
    this.drawn = state;
    const { ctx, eye } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const h = Math.max(0.06, open) * eye.height;
    const y = (HEIGHT - h) / 2;
    const shift = look * 22;
    ctx.drawImage(eye, 171 - eye.width / 2 + shift, y, eye.width, h);
    ctx.drawImage(eye, 469 - eye.width / 2 + shift, y, eye.width, h);
    if (line) this.text(line, WIDTH / 2, HEIGHT - 24, 2, '#ff9a3c');
    this.texture.needsUpdate = true;
  }
}
