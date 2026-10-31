import { reducedMotion } from './dom';

// The robot on the home page is decoration over a poster that's already on screen. Nothing here can fail loudly: if the
// 3D can't run, or can't keep up, the poster stays and the page reads the same.
const SLOW_MS = 1000 / 40;
const WATCH_MS = 3000;

function canRender(): boolean {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (reducedMotion() || connection?.saveData) return false;
  const context = document.createElement('canvas').getContext('webgl2');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  return Boolean(context);
}

async function run(host: HTMLElement): Promise<void> {
  const { startOffice } = await import('./office/index');
  const office = await startOffice(host);

  let onScreen = true;
  let frame = 0;
  let last = 0;
  let windowStart = 0;
  let frames = 0;
  let lowered = false;
  let stopped = false;

  const quit = (): void => {
    stopped = true;
    cancelAnimationFrame(frame);
    host.classList.remove('live');
    window.setTimeout(() => office.stop(), 800);
  };

  // Under 40 fps for 3 seconds, it drops the shadows and the resolution. If that's not enough, it goes back to the poster.
  const watch = (time: number): void => {
    if (!windowStart) windowStart = time;
    frames += 1;
    if (time - windowStart < WATCH_MS) return;
    const slow = (time - windowStart) / frames > SLOW_MS;
    windowStart = time;
    frames = 0;
    if (!slow) return;
    if (lowered) {
      quit();
    } else {
      lowered = true;
      office.lower();
    }
  };

  const tick = (time: number): void => {
    if (stopped) return;
    frame = 0;
    if (!onScreen || document.hidden) return;
    // A gap this long is the tab coming back, not a slow frame.
    if (time - last > 250) windowStart = 0;
    last = time;
    office.draw(time);
    watch(time);
    frame = requestAnimationFrame(tick);
  };
  const wake = (): void => {
    if (!stopped && !frame && onScreen && !document.hidden) frame = requestAnimationFrame(tick);
  };

  new IntersectionObserver(([entry]) => {
    onScreen = Boolean(entry?.isIntersecting);
    wake();
  }).observe(host);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(() => office.resize()).observe(host);
  office.canvas.addEventListener('webglcontextlost', quit);

  office.draw(performance.now());
  host.classList.add('live');
  wake();
}

export function startStage(): void {
  const host = document.getElementById('stage-art');
  if (!host || !canRender()) return;
  const begin = (): void => {
    requestAnimationFrame(() => setTimeout(() => void run(host).catch(() => undefined)));
  };
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
}
