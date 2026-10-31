import { startOffice, type Office, type OfficeFacts, type Size } from './index';
import type { RobotState } from '../../shared/robot';

// The whole 3D office runs in this worker, drawing to a canvas the page handed over. three.js compiles here, the scene
// is built here and every frame is drawn here, so a slow phone keeps scrolling whatever the robot is doing.
export type ToWorker =
  | { type: 'start'; canvas: OffscreenCanvas; size: Size; fixed: boolean; coarse: boolean }
  | { type: 'size'; size: Size }
  | { type: 'scroll'; y: number; story: number }
  | { type: 'mood'; mood: RobotState }
  | { type: 'facts'; facts: OfficeFacts }
  | { type: 'shot'; image: ImageBitmap; version: string }
  | { type: 'pointer'; x: number; y: number }
  | { type: 'click'; x: number; y: number }
  | { type: 'visible'; visible: boolean };

export type FromWorker = { type: 'ready' } | { type: 'gave-up' } | { type: 'thud' } | { type: 'key' };

const SLOW_MS = 1000 / 40;
const WATCH_MS = 3000;
// This many frames in a row, each this slow, and it doesn't wait the 3 seconds.
const HOPELESS_MS = 120;
const HOPELESS_FRAMES = 6;

const scope = globalThis as unknown as {
  onmessage: ((event: { data: ToWorker }) => void) | null;
  postMessage(message: FromWorker): void;
  requestAnimationFrame?: (callback: (time: number) => void) => number;
};
const say = (message: FromWorker): void => scope.postMessage(message);
const nextFrame = (callback: (time: number) => void): void => {
  if (scope.requestAnimationFrame) scope.requestAnimationFrame(callback);
  else setTimeout(() => callback(performance.now()), 16);
};

let office: Office | null = null;
let scrollY = 0;
let visible = true;
let running = false;
let stopped = false;
let last = 0;
let windowStart = 0;
let frames = 0;
let lowered = false;
let crawling = 0;
const waiting: ToWorker[] = [];

function giveUp(): void {
  stopped = true;
  say({ type: 'gave-up' });
}

// Under 40 fps for 3 seconds, it drops the shadows and the resolution. If that's not enough, it goes back to the poster.
function watch(time: number): void {
  if (!windowStart) windowStart = time;
  frames += 1;
  if (time - windowStart < WATCH_MS) return;
  const slow = (time - windowStart) / frames > SLOW_MS;
  windowStart = time;
  frames = 0;
  if (!slow) return;
  if (lowered) {
    giveUp();
  } else {
    lowered = true;
    office?.lower();
  }
}

function tick(time: number): void {
  running = false;
  if (stopped || !visible || !office) return;
  const gap = time - last;
  last = time;
  // A gap over 250 ms is the tab coming back, not a slow frame.
  if (gap > 250) windowStart = 0;
  crawling = gap > HOPELESS_MS && gap <= 250 ? crawling + 1 : 0;
  if (crawling >= HOPELESS_FRAMES) {
    giveUp();
    return;
  }
  office.draw(time, scrollY);
  watch(time);
  run();
}

function run(): void {
  if (running || stopped) return;
  running = true;
  nextFrame(tick);
}

function handle(message: ToWorker): void {
  if (!office) return;
  switch (message.type) {
    case 'size': office.resize(message.size); break;
    case 'scroll':
      scrollY = message.y;
      office.setStory(message.story);
      break;
    case 'mood': office.setMood(message.mood); break;
    case 'facts': office.setFacts(message.facts); break;
    case 'shot': office.setGameShot(message.image, message.version); break;
    case 'pointer': office.pointer(message.x, message.y); break;
    case 'click':
      office.pointer(message.x, message.y);
      if (office.hitsRobot(message.x, message.y)) office.poke();
      break;
    case 'visible':
      visible = message.visible;
      if (visible) run();
      break;
    default: break;
  }
}

scope.onmessage = ({ data }) => {
  if (data.type !== 'start') {
    if (office) handle(data);
    else waiting.push(data);
    return;
  }
  void startOffice(data.canvas, data.size, { fixed: data.fixed, coarse: data.coarse }).then((ready) => {
    office = ready;
    ready.onThud = () => say({ type: 'thud' });
    ready.onKey = () => say({ type: 'key' });
    data.canvas.addEventListener('webglcontextlost', giveUp);
    for (const message of waiting.splice(0)) handle(message);
    ready.draw(performance.now(), scrollY);
    say({ type: 'ready' });
    run();
  }).catch(giveUp);
};
