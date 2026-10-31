import { CanvasTexture, SRGBColorSpace } from 'three';
import { GLYPHS } from '../../shared/font';

const WIDTH = 640;
const HEIGHT = 186;
const EYE_WIDTH = 214;
const EYE_HEIGHT = 74;
const MARGIN = 44;

export type Tint = 'orange' | 'red';
const COLORS: Record<Tint, { edge: string; core: string; hot: string; text: string }> = {
  orange: { edge: '#ff7a1c', core: '#ffb054', hot: '#fff2d8', text: '#ffb054' },
  red: { edge: '#e0241a', core: '#ff4a38', hot: '#ffd2c8', text: '#ff6a58' },
};

// One eye from the PFP: a rounded slit, its colour at the edge and white-hot through the middle.
function paintEye(tint: Tint): OffscreenCanvas {
  const color = COLORS[tint];
  const canvas = new OffscreenCanvas(EYE_WIDTH + MARGIN * 2, EYE_HEIGHT + MARGIN * 2);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const slit = (inset: number, insetY: number, radius: number, fill: string, blur: number): void => {
    ctx.shadowColor = fill;
    ctx.shadowBlur = blur;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(MARGIN + inset, MARGIN + insetY, EYE_WIDTH - inset * 2, EYE_HEIGHT - insetY * 2, radius);
    ctx.fill();
  };
  slit(0, 0, 26, color.edge, 34);
  slit(7, 7, 20, color.core, 14);
  slit(28, 24, 12, color.hot, 10);
  return canvas;
}

export interface VisorState {
  open: number; // 1 is a full eye, 0 a shut one.
  look?: number; // -1 to 1, how far the eyes have moved across the screen.
  brightness?: number;
  tint?: Tint;
  scan?: number; // 0 to 1, where the scanning bar is. Leave it out for no bar.
  text?: string;
  textMix?: number; // 0 shows the eyes, 1 hands the screen to the text.
}

// The screen in the visor. It only redraws when something on it changes, so a still robot costs no uploads.
export class VisorScreen {
  readonly texture: CanvasTexture;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  private readonly eyes: Record<Tint, OffscreenCanvas> = { orange: paintEye('orange'), red: paintEye('red') };
  private drawn = '';

  constructor() {
    const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
    this.ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    this.texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  // Our bitmap font, so anything the visor says matches the rest of the site.
  private write(value: string, scale: number, color: string): void {
    const chars = value.toUpperCase();
    let x = Math.round((WIDTH - (chars.length * 6 - 1) * scale) / 2);
    const y = Math.round((HEIGHT - 7 * scale) / 2);
    this.ctx.fillStyle = color;
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = 12;
    for (const char of chars) {
      GLYPHS[char]?.forEach((bits, row) => {
        for (let col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) this.ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
        }
      });
      x += 6 * scale;
    }
    this.ctx.shadowBlur = 0;
  }

  draw({ open, look = 0, brightness = 1, tint = 'orange', scan, text = '', textMix = 0 }: VisorState): void {
    const key = `${open.toFixed(2)}|${look.toFixed(2)}|${brightness.toFixed(2)}|${tint}|${scan?.toFixed(3) ?? ''}|${textMix.toFixed(2)}|${textMix > 0 ? text : ''}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const { ctx } = this;
    const eye = this.eyes[tint];
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const eyes = 1 - textMix;
    if (eyes > 0.01) {
      const h = Math.max(0.05, open) * eye.height;
      const y = (HEIGHT - h) / 2;
      const shift = look * 24;
      ctx.globalAlpha = Math.min(1, brightness) * eyes;
      ctx.drawImage(eye, 171 - eye.width / 2 + shift, y, eye.width, h);
      ctx.drawImage(eye, 469 - eye.width / 2 + shift, y, eye.width, h);
    }
    if (scan !== undefined) {
      const x = scan * WIDTH;
      const bar = ctx.createLinearGradient(x - 46, 0, x + 46, 0);
      bar.addColorStop(0, 'rgba(255,176,84,0)');
      bar.addColorStop(0.5, 'rgba(255,190,110,0.5)');
      bar.addColorStop(1, 'rgba(255,176,84,0)');
      ctx.globalAlpha = eyes;
      ctx.fillStyle = bar;
      ctx.fillRect(x - 46, 0, 92, HEIGHT);
    }
    if (textMix > 0 && text) {
      ctx.globalAlpha = textMix;
      const scale = Math.max(2, Math.min(9, Math.floor((WIDTH - 48) / (text.length * 6))));
      this.write(text, scale, COLORS[tint].text);
    }
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }
}
