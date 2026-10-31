import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, Color, Mesh, MeshBasicMaterial, PCFShadowMap, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { buildRobot, ROBOT_TOP } from './robot';
import { buildStage, CABINET } from './stage';
import { buildSurfaces } from './surfaces';

const NIGHT = '#0b1020';
const FOV = 26;
// The height of the world in frame. It never changes with the screen's width, so the poster and the live canvas line up.
const FRAME_HEIGHT = 6.1;
// Below the desktop layout the art is cropped from the top, so the robot stays large above the text.
const PHONE_ZOOM = 1.15;

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

export interface Office {
  canvas: HTMLCanvasElement;
  draw(time: number): void;
  resize(): void;
  lower(): void;
  stop(): void;
  look(x: number, y: number, z: number, tx: number, ty: number, tz: number, fov: number): void;
}

const breathe = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve); });

function place(camera: PerspectiveCamera, width: number, height: number): void {
  const zoom = window.matchMedia('(min-width: 960px)').matches ? 1 : PHONE_ZOOM;
  const top = CABINET.h + ROBOT_TOP + 0.4;
  const distance = FRAME_HEIGHT / (Math.tan((FOV * Math.PI) / 360) * 2);
  camera.fov = FOV;
  camera.aspect = width / (height * zoom);
  camera.position.set(0, top - FRAME_HEIGHT / 2 + 0.3, distance);
  camera.lookAt(0, top - FRAME_HEIGHT / 2, 0);
  camera.setViewOffset(width, height * zoom, 0, 0, width, height);
}

// Built in steps with a pause between them, so a slow phone can still scroll while this happens.
export async function startOffice(host: HTMLElement, options: { pixelRatio?: number } = {}): Promise<Office> {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  scene.background = new Color(NIGHT);
  scene.environment = reflections(renderer);
  scene.environmentIntensity = 0.55;
  await breathe();
  const surfaces = buildSurfaces();
  await breathe();
  const robot = buildRobot(surfaces);
  await breathe();
  const stage = buildStage(scene, surfaces, robot.root);
  await breathe();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 80);

  let ratioCap = window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  const resize = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, ratioCap));
    renderer.setSize(width, height, false);
    place(camera, width, height);
  };
  resize();
  await renderer.compileAsync(scene, camera);
  host.append(canvas);

  let last = 0;
  let scrollWas = window.scrollY;
  const draw = (time: number): void => {
    const seconds = time / 1000;
    const dt = Math.max(0, seconds - last);
    last = seconds;
    const moved = window.scrollY - scrollWas;
    scrollWas = window.scrollY;
    robot.update(dt, seconds, Math.max(-1, Math.min(1, moved / 140)));
    stage.step(dt);
    renderer.render(scene, camera);
  };

  const lower = (): void => {
    renderer.shadowMap.enabled = false;
    scene.traverse((part) => { if (part instanceof Mesh) (part.material as MeshBasicMaterial).needsUpdate = true; });
    ratioCap = 1;
    resize();
  };

  const look: Office['look'] = (x, y, z, tx, ty, tz, fov) => {
    camera.clearViewOffset();
    camera.fov = fov;
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
    camera.updateProjectionMatrix();
  };

  return { canvas, draw, resize, lower, stop: () => { renderer.dispose(); canvas.remove(); }, look };
}
