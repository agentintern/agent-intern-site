import type { RobotState } from '../shared/robot';
import { reducedMotion } from './dom';
import type { Office } from './office/index';
import { hum, keyClick, stampThud } from './sound';

// The robot is decoration over a poster that's already on screen. Nothing here can fail loudly: if the 3D can't run, or
// can't keep up, the poster stays and the page reads the same.
const SLOW_MS = 1000 / 40;
const WATCH_MS = 3000;
// This many frames in a row, each this slow, and it doesn't wait the 3 seconds.
const HOPELESS_MS = 120;
const HOPELESS_FRAMES = 6;
const PROBE_MS = 4000;
const MOODS: readonly string[] = ['asleep', 'working', 'thinking', 'stuck', 'panicking', 'celebrating', 'refusing'];

let office: Office | null = null;
let story: HTMLElement | null = null;

function canRender(): Promise<boolean> {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (reducedMotion() || connection?.saveData) return Promise.resolve(false);
  return new Promise((resolve) => {
    const worker = new Worker('/js/gl-probe.js');
    const finish = (usable: boolean): void => {
      worker.terminate();
      resolve(usable);
    };
    worker.onmessage = (event) => finish(event.data === true);
    worker.onerror = () => finish(false);
    setTimeout(() => finish(false), PROBE_MS);
  });
}

// The mood comes from one place: the state the server wrote into the page. Refreshes update it there.
function readMood(): RobotState {
  const value = document.getElementById('scene')?.dataset.state ?? document.getElementById('stage-art')?.dataset.state;
  return (MOODS.includes(value ?? '') ? value : 'asleep') as RobotState;
}

export function syncStage(): void {
  const host = document.getElementById('stage-art');
  if (!host || !office) return;
  const mood = readMood();
  office.setMood(mood);
  host.dataset.mood = mood;
  const record = document.getElementById('record-facts')?.dataset;
  const closes = Number(document.querySelector<HTMLElement>('[data-countdown]')?.dataset.countdown ?? 0);
  office.setFacts({
    closes,
    last: record?.last ?? '',
    counts: [Number(record?.shipped ?? 0), Number(record?.refused ?? 0), Number(record?.failed ?? 0), Number(record?.rolled ?? 0)],
  });
}

// Where the page is in the story: 0 to 3, resting on each chapter while its panel is in view.
function storyPosition(chapters: HTMLElement[]): number {
  const y = window.innerHeight * 0.4;
  const tops = chapters.map((chapter) => chapter.getBoundingClientRect().top);
  let index = 0;
  while (index < tops.length - 1 && (tops[index + 1] as number) <= y) index++;
  if (index === tops.length - 1) return index;
  const here = tops[index] as number;
  const next = tops[index + 1] as number;
  const k = Math.max(0, Math.min(1, (y - here) / (next - here)));
  return index + Math.max(0, Math.min(1, (k - 0.4) / 0.5));
}

function startStory(): void {
  story = document.getElementById('story');
  if (!story) return;
  const chapters = [...story.querySelectorAll<HTMLElement>('[data-chapter]')];
  const links = [...story.querySelectorAll<HTMLAnchorElement>('.rail a')];
  const strip = document.getElementById('strip');
  const update = (): void => {
    const position = storyPosition(chapters);
    const current = Math.round(position);
    links.forEach((link, i) => {
      if (i === current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    office?.setStory(position);
    if (strip?.parentElement && !reducedMotion()) {
      const spare = Math.max(0, strip.scrollWidth - strip.parentElement.clientWidth);
      const box = chapters[1]?.getBoundingClientRect();
      const k = box ? Math.max(0, Math.min(1, (window.innerHeight * 0.7 - box.top) / box.height)) : 0;
      strip.style.transform = `translateX(${-spare * k}px)`;
    }
  };
  let pending = false;
  const onScroll = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      update();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

// Types and deletes the practice board's sample tasks. They're labeled "example" on the page.
function startTaskBox(): void {
  const line = document.getElementById('task-type');
  if (!line || reducedMotion()) return;
  const samples = JSON.parse(line.dataset.samples ?? '[]') as string[];
  if (samples.length === 0) return;
  let which = 0;
  let shown = (samples[0] as string).length;
  let typing = false;
  const tick = (): void => {
    const text = samples[which] as string;
    shown += typing ? 1 : -1;
    line.textContent = text.slice(0, Math.max(0, shown));
    let wait = typing ? 46 : 22;
    if (typing && shown >= text.length) {
      typing = false;
      wait = 2200;
    } else if (!typing && shown <= 0) {
      which = (which + 1) % samples.length;
      typing = true;
      wait = 400;
    }
    setTimeout(tick, wait);
  };
  setTimeout(tick, 2600);
}

async function run(host: HTMLElement): Promise<void> {
  const { startOffice } = await import('./office/index');
  // The art takes the full screen behind the story before the canvas measures it.
  story?.classList.add('live');
  const live = await startOffice(host, { fixed: !story });
  office = live;
  live.onThud = stampThud;
  live.onKey = keyClick;
  syncStage();
  const shot = host.dataset.shot;
  if (shot) void live.setGameShot(shot, host.dataset.shotVersion ?? '').catch(() => undefined);
  window.dispatchEvent(new Event('scroll'));

  let onScreen = true;
  let frame = 0;
  let last = 0;
  let windowStart = 0;
  let frames = 0;
  let lowered = false;
  let stopped = false;
  let crawling = 0;

  const quit = (): void => {
    stopped = true;
    cancelAnimationFrame(frame);
    host.classList.remove('live', 'ready');
    story?.classList.remove('live');
    hum(false);
    office = null;
    window.setTimeout(() => live.stop(), 800);
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
      live.lower();
    }
  };

  const tick = (time: number): void => {
    if (stopped) return;
    frame = 0;
    if (!onScreen || document.hidden) {
      hum(false);
      return;
    }
    const gap = time - last;
    last = time;
    // A gap over 250 ms is the tab coming back, not a slow frame.
    if (gap > 250) windowStart = 0;
    crawling = gap > HOPELESS_MS && gap <= 250 ? crawling + 1 : 0;
    if (crawling >= HOPELESS_FRAMES) {
      quit();
      return;
    }
    live.draw(time);
    hum(true);
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
  new ResizeObserver(() => live.resize()).observe(host);
  live.canvas.addEventListener('webglcontextlost', quit);

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') live.pointer(event.clientX, event.clientY);
  }, { passive: true });
  // A click or a tap on the robot itself. Anything that does something on the page keeps its click.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, textarea, select, label, .chapter-panel, .stage-text, header, footer, nav')) return;
    live.pointer(event.clientX, event.clientY);
    if (live.hitsRobot(event.clientX, event.clientY)) live.poke();
  });

  live.draw(performance.now());
  host.classList.add('live');
  window.setTimeout(() => host.classList.add('ready'), 800);
  wake();
}

export function startStage(): void {
  const host = document.getElementById('stage-art');
  if (!host) return;
  host.dataset.mood = readMood();
  startStory();
  startTaskBox();
  const begin = (): void => {
    requestAnimationFrame(() => setTimeout(() => {
      void canRender().then((usable) => (usable ? run(host) : undefined)).catch(() => story?.classList.remove('live'));
    }));
  };
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
}
