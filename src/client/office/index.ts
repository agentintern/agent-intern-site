import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, Color, Mesh, MeshBasicMaterial, PCFShadowMap, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import type { RobotState } from '../../shared/robot';
import { buildRobot, ROBOT_TOP } from './robot';
import { buildStage, CABINET, type DrawerCounts } from './stage';
import { buildSurfaces } from './surfaces';

const NIGHT = '#0b1020';
const FOV = 26;
// The height of the world in the opening frame. It never changes with the screen's width, so the poster and the live
// canvas line up.
const FRAME_HEIGHT = 6.1;
// Below the desktop layout the robot is framed in the top part of the screen, above the text.
const PHONE_ZOOM = 1.15;
const OPEN_TOP = CABINET.h + ROBOT_TOP + 0.4;
const OPEN_DISTANCE = FRAME_HEIGHT / (Math.tan((FOV * Math.PI) / 360) * 2);

interface View { at: [number, number, number]; aim: [number, number, number]; fov: number; shift: number }

// The four chapters. `shift` moves the subject right of centre on a wide screen, so the text has the left side.
const VIEWS: [View, View, View, View] = [
  { at: [0, OPEN_TOP - FRAME_HEIGHT / 2 + 0.3, OPEN_DISTANCE], aim: [0, OPEN_TOP - FRAME_HEIGHT / 2, 0], fov: FOV, shift: 0 },
  { at: [0.3, 6.5, 6.2], aim: [0, 6.3, 0], fov: 24, shift: 0.16 },
  { at: [1.5, 4.7, 10.6], aim: [2.05, 4.38, -0.3], fov: 30, shift: -0.15 },
  { at: [3.7, 3.3, 10.2], aim: [0.1, 3.72, 0], fov: 35, shift: 0.17 },
];

// A small room of soft panels that gives the metal something to reflect. It's never seen directly.
function reflections(renderer: WebGLRenderer): Scene['environment'] {
  const room = new Scene();
  room.background = new Color('#0a0f1e');
  const panel = (color: string, strength: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
    const mesh = new Mesh(new BoxGeometry(sx, sy, sz), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(strength), side: BackSide }));
    mesh.position.set(x, y, z);
    room.add(mesh);
  };
  panel('#141d36', 1, 0, 0, 0, 40, 40, 40);
  panel('#aeb8c8', 1.25, 0, 3, 16, 26, 16, 1);
  panel('#ffb070', 5.2, 9, 6, 9, 6, 12, 1);
  panel('#ffe2c0', 2.4, 0, 16, 7, 18, 1, 7);
  panel('#7fa8ff', 3.4, -13, 5, -3, 1, 14, 9);
  panel('#2c3e70', 1.6, 5, -2, -14, 14, 12, 1);
  panel('#ff9a3c', 1.1, 0, -9, 7, 16, 1, 9);
  const pmrem = new PMREMGenerator(renderer);
  const { texture } = pmrem.fromScene(room, 0.03);
  pmrem.dispose();
  return texture;
}

export interface OfficeFacts {
  closes: number; // When the vote closes, in ms. The visor counts down to this.
  last: string; // The last shift's result, for the visor.
  counts: DrawerCounts;
}

export interface Office {
  canvas: HTMLCanvasElement;
  draw(time: number): void;
  resize(): void;
  lower(): void;
  stop(): void;
  setMood(mood: RobotState): void;
  setFacts(facts: OfficeFacts): void;
  setGameShot(url: string, version: string): Promise<void>;
  setStory(chapter: number): void;
  pointer(x: number, y: number): void;
  hitsRobot(x: number, y: number): boolean;
  poke(): void;
  // For the renders in scripts/. They freeze the robot in a pose and jump straight to it.
  still(pose: 'rest' | 'shrug' | 'asleep'): void;
  look(x: number, y: number, z: number, tx: number, ty: number, tz: number, fov: number): void;
  onThud: () => void;
  onKey: () => void;
}

const breathe = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve); });
const ease = (t: number): number => t * t * (3 - 2 * t);
const pad = (n: number): string => String(n).padStart(2, '0');

function countdown(closes: number): string {
  const total = Math.floor(Math.max(0, closes - Date.now()) / 1000);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

// How much of a chapter is showing, from 0 to 1.
const near = (story: number, chapter: number): number => Math.max(0, 1 - Math.abs(story - chapter));

const STAMPS: Partial<Record<RobotState, string>> = { celebrating: 'SHIPPED', refusing: 'REFUSED' };

// Built in steps with a pause between them, so a slow phone can still scroll while this happens.
export async function startOffice(host: HTMLElement, options: { pixelRatio?: number; opaque?: boolean; fixed?: boolean } = {}): Promise<Office> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: !options.opaque, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  // Transparent over the page's night colour, so the guide lines can sit behind the robot.
  if (options.opaque) scene.background = new Color(NIGHT);
  scene.environment = reflections(renderer);
  scene.environmentIntensity = 0.55;
  await breathe();
  const surfaces = buildSurfaces();
  await breathe();
  const robot = buildRobot(surfaces);
  await breathe();
  const stage = buildStage(scene, surfaces, robot.root);
  stage.guide.visible = Boolean(options.opaque);
  await breathe();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 80);

  let width = 1;
  let height = 1;
  let frameHeight = 1;
  let wide = true;
  let ratioCap = window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  const resize = (): void => {
    width = host.clientWidth;
    height = host.clientHeight;
    wide = window.matchMedia('(min-width: 960px)').matches;
    // The same sum as --art-h in site.css. The frame is taller than the art on a phone, and starts at the top.
    frameHeight = wide || options.fixed ? height : Math.max(300, Math.min(0.58 * height, 1.18 * width)) * PHONE_ZOOM;
    renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, ratioCap));
    renderer.setSize(width, height, false);
    camera.aspect = width / frameHeight;
  };
  resize();

  let storyTarget = 0;
  let story = 0;
  const from = new Vector3();
  const to = new Vector3();
  const aim = new Vector3();
  const aimTo = new Vector3();
  let posed = false;
  const place = (): void => {
    if (posed) return;
    const index = Math.min(2, Math.floor(story));
    const k = ease(story - index);
    const a = VIEWS[index] as View;
    const b = VIEWS[index + 1] as View;
    from.fromArray(a.at).lerp(to.fromArray(b.at), k);
    aim.fromArray(a.aim).lerp(aimTo.fromArray(b.aim), k);
    camera.position.copy(from);
    camera.lookAt(aim);
    camera.fov = a.fov + (b.fov - a.fov) * k;
    const shift = wide ? (a.shift + (b.shift - a.shift) * k) * width : 0;
    camera.setViewOffset(width, frameHeight, -shift, 0, width, height);
  };
  place();
  await renderer.compileAsync(scene, camera);
  host.append(canvas);

  let last = 0;
  let scrollWas = window.scrollY;
  let mood: RobotState = 'asleep';
  let facts: OfficeFacts = { closes: 0, last: '', counts: [0, 0, 0, 0] };
  let pointerX = -1;
  let pointerY = -1;
  let pointerAt = -1e9;
  let aimX = 0;
  let aimY = 0;
  let nextKey = 0;
  const headSpot = new Vector3();
  const sideSpot = new Vector3();
  const feetSpot = new Vector3();
  const toScreen = (v: Vector3): [number, number] => {
    const p = v.clone().project(camera);
    return [((p.x + 1) / 2) * width, ((1 - p.y) / 2) * height];
  };
  const office: Office = {
    canvas,
    onThud: () => undefined,
    onKey: () => undefined,
    draw(time) {
      const seconds = time / 1000;
      const dt = Math.max(0, seconds - last);
      last = seconds;
      const moved = window.scrollY - scrollWas;
      scrollWas = window.scrollY;
      story += (storyTarget - story) * (1 - Math.exp(-Math.min(dt, 0.05) * 6));
      if (Math.abs(storyTarget - story) < 1e-4) story = storyTarget;
      place();

      robot.headAnchor.getWorldPosition(headSpot);
      const [hx, hy] = toScreen(headSpot);
      const live = seconds - pointerAt < 3;
      const wantX = live ? Math.max(-1, Math.min(1, (pointerX - hx) / (width * 0.32))) : 0;
      const wantY = live ? Math.max(-1, Math.min(1, (pointerY - hy) / (height * 0.42))) : 0;
      aimX += (wantX - aimX) * (1 - Math.exp(-Math.min(dt, 0.05) * 8));
      aimY += (wantY - aimY) * (1 - Math.exp(-Math.min(dt, 0.05) * 8));
      const close = live && Math.hypot(pointerX - hx, pointerY - hy) < Math.max(170, height * 0.24);

      const job = near(story, 1);
      const record = near(story, 3);
      robot.update({
        dt,
        time: seconds,
        kick: Math.max(-1, Math.min(1, moved / 140)),
        aimX,
        aimY,
        near: close,
        turn: near(story, 2),
        raise: job,
        lookDown: record,
        text: record > job ? facts.last : countdown(facts.closes),
        textMix: Math.max(job, record) ** 2,
      });
      stage.setDrawers(ease(Math.max(0, Math.min(1, story - 2))));
      stage.step(dt, seconds);
      if (mood === 'working' && seconds > nextKey) {
        nextKey = seconds + 0.08 + ((Math.sin(seconds * 13.7) + 1) / 2) * 0.22;
        office.onKey();
      }
      renderer.render(scene, camera);
    },
    resize() {
      resize();
      place();
    },
    lower() {
      renderer.shadowMap.enabled = false;
      scene.traverse((part) => { if (part instanceof Mesh) (part.material as MeshBasicMaterial).needsUpdate = true; });
      ratioCap = 1;
      resize();
    },
    stop() {
      renderer.dispose();
      canvas.remove();
    },
    setMood(next) {
      if (next === mood) return;
      mood = next;
      robot.setMood(next);
      stage.setShift(next === 'working' || next === 'thinking' || next === 'stuck');
      stage.stamp(STAMPS[next] ?? null);
    },
    setFacts(next) {
      facts = next;
      stage.setCounts(next.counts);
    },
    setGameShot: (url, version) => stage.setGameShot(url, version),
    setStory(chapter) { storyTarget = chapter; },
    pointer(x, y) {
      const box = canvas.getBoundingClientRect();
      pointerX = x - box.left;
      pointerY = y - box.top;
      pointerAt = last;
    },
    hitsRobot(x, y) {
      const box = canvas.getBoundingClientRect();
      robot.headAnchor.getWorldPosition(headSpot);
      sideSpot.copy(headSpot).setX(headSpot.x + 1);
      feetSpot.copy(headSpot).setY(CABINET.h);
      const [hx, hy] = toScreen(headSpot);
      const [sx] = toScreen(sideSpot);
      const [, fy] = toScreen(feetSpot);
      const unit = Math.abs(sx - hx);
      const px = x - box.left;
      const py = y - box.top;
      return Math.abs(px - hx) < unit * 1.1 && py > hy - unit * 0.7 && py < fy;
    },
    poke: () => robot.poke(),
    still(pose) {
      robot.hold(pose === 'asleep' ? null : pose);
      robot.settle();
    },
    look(x, y, z, tx, ty, tz, fov) {
      posed = true;
      camera.clearViewOffset();
      camera.fov = fov;
      camera.position.set(x, y, z);
      camera.lookAt(tx, ty, tz);
      camera.updateProjectionMatrix();
    },
  };
  stage.onThud = () => office.onThud();
  return office;
}
