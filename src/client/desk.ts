// The intern at a desk: a small scene painted in code. It reacts to the shift state, sleeps between
// shifts, panics when tests fail and celebrates a ship.
export type DeskMood = 'off-shift' | 'reading' | 'writing' | 'testing' | 'stuck' | 'gate' | 'panic' | 'shipped' | 'paused';

const W = 160;
const H = 110;
const SKIN = '#f2c29b';
const HAIR = '#4a2f22';
const SHIRT = '#fffdf6';
const TIE = '#d9402f';
const INK = '#1c1a26';

export class Desk {
  private ctx: CanvasRenderingContext2D;
  private mood: DeskMood = 'off-shift';
  private frame = 0;
  private confetti: { x: number; y: number; vy: number; color: string }[] = [];
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private last = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    this.ctx = ctx;
    this.paint();
    if (!this.reduced) requestAnimationFrame((t) => this.loop(t));
  }

  setMood(mood: DeskMood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === 'shipped') {
      const colors = ['#ffd84a', '#5fd3a3', '#d9402f', '#7fb8e8'];
      this.confetti = Array.from({ length: 34 }, (_, i) => ({
        x: (i * 47) % W,
        y: -((i * 13) % 60),
        vy: 0.5 + ((i * 7) % 10) / 12,
        color: colors[i % colors.length] as string,
      }));
    }
    this.paint();
  }

  private loop(time: number): void {
    if (time - this.last > 110) {
      this.last = time;
      this.frame++;
      if (!document.hidden) this.paint();
    }
    requestAnimationFrame((t) => this.loop(t));
  }

  private rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  private room(): void {
    const asleep = this.mood === 'off-shift';
    this.rect(0, 0, W, H, asleep ? '#38354a' : '#d9cfb8');
    this.rect(0, 80, W, 30, asleep ? '#2c2a3a' : '#5b6577');
    this.rect(0, 79, W, 2, asleep ? '#25222f' : '#b7ac94');
    // Window.
    this.rect(14, 12, 44, 34, INK);
    this.rect(16, 14, 40, 30, asleep ? '#14122a' : '#7fb8e8');
    if (asleep) {
      this.rect(44, 19, 5, 5, '#f5edd8');
      this.rect(22, 22, 1, 1, '#f5edd8');
      this.rect(33, 31, 1, 1, '#f5edd8');
    } else {
      this.rect(22, 26, 12, 3, '#fffdf6');
      this.rect(26, 23, 8, 3, '#fffdf6');
    }
    this.rect(35, 14, 2, 30, INK);
    // Plant.
    this.rect(136, 64, 10, 16, '#c1633d');
    this.rect(133, 50, 16, 14, '#2f7a55');
    this.rect(137, 45, 4, 8, '#44a374');
  }

  private monitor(): void {
    const m = this.mood;
    const f = this.frame;
    this.rect(84, 42, 44, 30, INK);
    this.rect(102, 72, 8, 4, '#4a505c');
    this.rect(96, 75, 20, 2, '#4a505c');
    const sx = 86;
    const sy = 44;
    if (m === 'off-shift') {
      this.rect(sx, sy, 40, 26, '#121018');
      return;
    }
    const bad = m === 'panic';
    const good = m === 'shipped';
    this.rect(sx, sy, 40, 26, bad ? (f % 4 < 2 ? '#d9402f' : '#7a1f15') : good ? '#0e6647' : '#14324a');
    if (m === 'writing' || m === 'reading') {
      const count = m === 'writing' ? (f % 7) + 1 : 6;
      for (let i = 0; i < count; i++) {
        const w = 6 + ((i * 37 + (m === 'writing' ? f : 0)) % 26);
        this.rect(sx + 3, sy + 3 + i * 3, w, 1, i % 3 === 0 ? '#ffd84a' : '#5fd3a3');
      }
    } else if (m === 'testing') {
      this.rect(sx + 5, sy + 11, 30, 5, INK);
      this.rect(sx + 6, sy + 12, (f * 2) % 29, 3, '#5fd3a3');
    } else if (m === 'stuck') {
      this.rect(sx + 14, sy + 6, 12, 3, '#ffd84a');
      this.rect(sx + 23, sy + 8, 3, 5, '#ffd84a');
      this.rect(sx + 18, sy + 12, 5, 3, '#ffd84a');
      this.rect(sx + 18, sy + 18, 4, 3, '#ffd84a');
    } else if (m === 'gate') {
      for (let i = 0; i < 3; i++) this.rect(sx + 10 + i * 9, sy + 11, 5, 5, f % 3 === i ? '#ffd84a' : '#3b3848');
    } else if (bad) {
      this.rect(sx + 18, sy + 5, 4, 11, '#fffdf6');
      this.rect(sx + 18, sy + 18, 4, 4, '#fffdf6');
    } else if (good) {
      this.rect(sx + 10, sy + 13, 4, 4, '#fffdf6');
      this.rect(sx + 14, sy + 16, 4, 4, '#fffdf6');
      this.rect(sx + 18, sy + 12, 4, 4, '#fffdf6');
      this.rect(sx + 22, sy + 8, 4, 4, '#fffdf6');
      this.rect(sx + 26, sy + 4, 4, 4, '#fffdf6');
    } else if (m === 'paused') {
      this.rect(sx + 13, sy + 7, 5, 13, '#fffdf6');
      this.rect(sx + 23, sy + 7, 5, 13, '#fffdf6');
    }
  }

  private internAsleep(): void {
    const f = this.frame;
    // Slumped on the desk, head on arms.
    this.rect(58, 66, 22, 12, SHIRT);
    this.rect(70, 60, 20, 12, SHIRT);
    this.rect(76, 56, 16, 12, SKIN);
    this.rect(76, 54, 16, 6, HAIR);
    this.rect(84, 62, 4, 1, INK);
    const drift = Math.floor(f / 4) % 16;
    const z = (x: number, y: number, size: number): void => {
      this.rect(x, y, size, 1, '#f5edd8');
      this.rect(x + size - 1, y + 1, 1, 1, '#f5edd8');
      this.rect(x, y + 2, size, 1, '#f5edd8');
    };
    z(96, 50 - drift, 4);
    z(104, 40 - drift, 5);
  }

  private internAwake(): void {
    const m = this.mood;
    const f = this.frame;
    const bob = m === 'writing' ? f % 2 : 0;
    // Chair.
    this.rect(44, 52, 16, 28, '#39343f');
    this.rect(48, 80, 8, 12, '#39343f');
    // Body.
    this.rect(52, 58 + bob, 20, 22, SHIRT);
    this.rect(60, 58 + bob, 4, 16, TIE);
    // Head.
    this.rect(54, 40 + bob, 18, 18, SKIN);
    const spiked = m === 'panic';
    this.rect(52, 36 + bob, 22, 7, HAIR);
    if (spiked) {
      for (let i = 0; i < 5; i++) this.rect(53 + i * 4, 30 + (i % 2) * 2 + bob, 2, 7, HAIR);
    }
    // Eyes, looking at the screen.
    const look = m === 'reading' ? (Math.floor(f / 6) % 2) * 2 : 2;
    this.rect(64 + look, 47 + bob, 2, 3, INK);
    this.rect(58 + look, 47 + bob, 2, 3, INK);
    if (m === 'shipped') {
      this.rect(59, 53, 8, 2, INK);
      this.rect(44, 40, 7, 4, SKIN);
      this.rect(72, 40, 7, 4, SKIN);
      this.rect(46, 44, 7, 16, SHIRT);
      this.rect(71, 44, 7, 16, SHIRT);
    } else if (spiked) {
      this.rect(60, 52, 6, 4, INK);
      const shake = f % 2;
      this.rect(44 + shake, 34, 7, 4, SKIN);
      this.rect(74 + shake, 34, 7, 4, SKIN);
      this.rect(46 + shake, 38, 7, 20, SHIRT);
      this.rect(72 + shake, 38, 7, 20, SHIRT);
      this.rect(49, 46 + (f % 6), 2, 3, '#7fb8e8');
    } else if (m === 'stuck') {
      this.rect(60, 54, 6, 1, INK);
      this.rect(72, 42, 6, 4, SKIN);
      this.rect(73, 46, 6, 14, SHIRT);
      this.rect(82, 26, 10, 3, TIE);
      this.rect(89, 28, 3, 6, TIE);
      this.rect(84, 33, 6, 3, TIE);
      this.rect(84, 39, 4, 3, TIE);
    } else {
      this.rect(60, 54, 6, 1, INK);
      // Arms reach to the keyboard.
      const type = m === 'writing' ? f % 2 : 0;
      this.rect(70, 64 + bob, 16, 5, SHIRT);
      this.rect(84, 65 + type, 6, 4, SKIN);
      this.rect(84, 68 - type, 6, 3, SKIN);
    }
    if (m === 'gate') {
      this.rect(66, 74, 6, 6, '#f5edd8');
      this.rect(67, 75, 4, 2, '#8a5433');
    }
  }

  private confettiFall(): void {
    for (const piece of this.confetti) {
      piece.y += piece.vy;
      if (piece.y > H) piece.y = -4;
      this.rect(piece.x, Math.floor(piece.y), 2, 3, piece.color);
    }
  }

  private paint(): void {
    this.room();
    this.rect(30, 76, 112, 5, '#a4744d');
    this.rect(30, 81, 112, 3, '#7d5639');
    this.rect(36, 84, 5, 22, '#7d5639');
    this.rect(130, 84, 5, 22, '#7d5639');
    this.monitor();
    if (this.mood === 'off-shift') this.internAsleep();
    else this.internAwake();
    this.rect(88, 74, 22, 2, '#d8cdb2');
    if (this.mood === 'shipped') this.confettiFall();
  }
}

export const STATE_WORDS: Record<string, string> = {
  'off-shift': 'off shift',
  reading: 'reading the task',
  writing: 'writing',
  testing: 'testing',
  stuck: 'stuck',
  gate: 'at the gate',
  panic: 'panicking',
  shipped: 'shipped',
  paused: 'paused',
};

export function moodFor(state: string | null | undefined, paused: boolean, lastStatus?: string | null, lastEventFailed = false): DeskMood {
  if (paused && !state) return 'paused';
  if (state === 'reading' || state === 'writing' || state === 'stuck' || state === 'gate') return lastEventFailed ? 'panic' : state;
  if (state === 'testing') return 'testing';
  if (!state && lastStatus === 'shipped') return 'shipped';
  return 'off-shift';
}
