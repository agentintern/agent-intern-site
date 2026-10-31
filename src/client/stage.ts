import type { RobotState } from '../shared/robot';
import { reducedMotion } from './dom';
import type { FromWorker, ToWorker } from './office/worker';
import { hum, keyClick, stampThud } from './sound';

// The robot is decoration over a poster that's already on screen. Nothing here can fail loudly: if the 3D can't run, or
// can't keep up, the poster stays and the page reads the same.
const PROBE_MS = 4000;
const MOODS: readonly string[] = ['asleep', 'working', 'thinking', 'stuck', 'panicking', 'celebrating', 'refusing'];

let office: Worker | null = null;
let story: HTMLElement | null = null;

const tell = (message: ToWorker): void => office?.postMessage(message);

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
  if (!host) return;
  const mood = readMood();
  host.dataset.mood = mood;
  tell({ type: 'mood', mood });
  const record = document.getElementById('record-facts')?.dataset;
  const closes = Number(document.querySelector<HTMLElement>('[data-countdown]')?.dataset.countdown ?? 0);
  tell({
    type: 'facts',
    facts: {
      closes,
      last: record?.last ?? '',
      counts: [Number(record?.shipped ?? 0), Number(record?.refused ?? 0), Number(record?.failed ?? 0), Number(record?.rolled ?? 0)],
    },
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
    tell({ type: 'scroll', y: window.scrollY, story: position });
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

function measure(host: HTMLElement): { width: number; height: number; ratio: number; wide: boolean } {
  return { width: host.clientWidth, height: host.clientHeight, ratio: window.devicePixelRatio || 1, wide: window.matchMedia('(min-width: 960px)').matches };
}

// Hands a canvas to the worker. From here on, nothing the 3D does can hold up this page.
function run(host: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // The art takes the full screen behind the story before it's measured.
  story?.classList.add('live');
  host.append(canvas);
  const worker = new Worker(host.dataset.worker ?? '');
  office = worker;

  const giveUp = (): void => {
    host.classList.remove('live', 'ready');
    story?.classList.remove('live');
    hum(false);
    office = null;
    window.setTimeout(() => {
      worker.terminate();
      canvas.remove();
    }, 800);
  };
  worker.onerror = giveUp;
  worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
    if (data.type === 'ready') {
      host.classList.add('live');
      window.setTimeout(() => host.classList.add('ready'), 800);
    } else if (data.type === 'thud') {
      stampThud();
    } else if (data.type === 'key') {
      keyClick();
    } else {
      giveUp();
    }
  };

  const offscreen = canvas.transferControlToOffscreen();
  worker.postMessage({ type: 'start', canvas: offscreen, size: measure(host), fixed: !story, coarse: window.matchMedia('(pointer: coarse)').matches } satisfies ToWorker, [offscreen]);
  syncStage();
  const shot = host.dataset.shot;
  if (shot) tell({ type: 'shot', url: new URL(shot, location.href).href, version: host.dataset.shotVersion ?? '' });
  window.dispatchEvent(new Event('scroll'));

  let onScreen = true;
  const report = (): void => {
    const visible = onScreen && !document.hidden;
    tell({ type: 'visible', visible });
    hum(visible);
  };
  new IntersectionObserver(([entry]) => {
    onScreen = Boolean(entry?.isIntersecting);
    report();
  }).observe(host);
  document.addEventListener('visibilitychange', report);
  new ResizeObserver(() => tell({ type: 'size', size: measure(host) })).observe(host);

  const inside = (event: MouseEvent): { x: number; y: number } => {
    const box = host.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') tell({ type: 'pointer', ...inside(event) });
  }, { passive: true });
  // A click or a tap on the robot itself. Anything that does something on the page keeps its click.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, textarea, select, label, .chapter-panel, .stage-text, header, footer, nav')) return;
    tell({ type: 'click', ...inside(event) });
  });
}

export function startStage(): void {
  const host = document.getElementById('stage-art');
  if (!host) return;
  host.dataset.mood = readMood();
  startStory();
  startTaskBox();
  const begin = (): void => {
    requestAnimationFrame(() => setTimeout(() => {
      void canRender().then((usable) => { if (usable) run(host); });
    }));
  };
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
}
