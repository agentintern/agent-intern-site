import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Group,
  HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight,
  Scene, SpotLight, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Material,
} from 'three';
import { densify, loft, plate, roundedProfile, roundedRect, smoothRings, tube } from './shapes';
import { softGlow, type Surfaces } from './surfaces';

export const CABINET = { w: 2.3, h: 2.6, d: 1.5 };
const CRT_STAND = { x: 3.5, w: 2.1, h: 1.5, d: 1.5 };

function part(geometry: BufferGeometry, material: Material, shadow = true): Mesh {
  const m = new Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

const block = (w: number, h: number, d: number, r: number): BufferGeometry => loft(roundedProfile(h / 2, w / 2, d / 2, r, 9, 3), 40);

// Dents are pushed into the sheet metal itself, so the lamp catches them.
function dentedBox(w: number, h: number, d: number, dents: [number, number, number, number][]): BufferGeometry {
  const geometry = new BoxGeometry(w, h, d, 56, 72, 18);
  const position = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    let push = 0;
    for (const [dx, dy, r, depth] of dents) push += depth * Math.exp(-(((x - dx) ** 2 + (y - dy) ** 2) / (r * r)));
    if (z > d / 2 - 1e-3) position.setZ(i, z - push);
    if (Math.abs(x - w / 2) < 1e-3) position.setX(i, x - push * 0.4);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildDrawer(s: Surfaces, w: number, h: number, seed: number): Group {
  const drawer = new Group();
  const lean = (seed % 3) * 0.006;
  const front = part(dentedBox(w, h, 0.12, [[(seed % 5) * 0.2 - 0.4, (seed % 2) * 0.1 - 0.06, 0.22, 0.03], [0.7 - seed * 0.12, 0.1, 0.14, 0.022]]), s.cabinet);
  front.position.z = -0.035;
  drawer.add(front);
  drawer.rotation.x = lean;
  const pull = part(tube([
    { at: new Vector3(-0.24, -0.07, 0.03), rx: 0.016 },
    { at: new Vector3(-0.22, -0.07, 0.085), rx: 0.018 },
    { at: new Vector3(0, -0.075, 0.1), rx: 0.022 },
    { at: new Vector3(0.22, -0.07, 0.085), rx: 0.018 },
    { at: new Vector3(0.24, -0.07, 0.03), rx: 0.016 },
  ], 10, 5), s.steel);
  pull.position.y = -h * 0.08;
  drawer.add(pull);
  const holder = part(plate(roundedRect(0.5, 0.15, 0.014, 2), () => 0.025, { lift: 0.012, edge: 0.012, rings: 2 }), s.steel, false);
  holder.position.y = h * 0.24;
  drawer.add(holder);
  const label = part(plate(roundedRect(0.44, 0.1, 0.005, 2), () => 0.025, { lift: 0.018, edge: 0.002, rings: 2 }), s.paper, false);
  label.position.y = h * 0.24;
  drawer.add(label);
  return drawer;
}

function buildCabinet(s: Surfaces, w: number, h: number, d: number, drawers: number, dents: [number, number, number, number][]): Group {
  const cabinet = new Group();
  const body = part(dentedBox(w, h, d, dents), s.cabinet);
  body.position.y = h / 2;
  cabinet.add(body);
  const lid = part(new BoxGeometry(w + 0.02, 0.05, d + 0.02), s.cabinet);
  lid.position.y = h + 0.012;
  cabinet.add(lid);
  // The gaps between the drawers read as dark, because the frame behind them is.
  const recess = part(new BoxGeometry(w - 0.13, h - 0.05, 0.02), s.joint, false);
  recess.position.set(0, h / 2, d / 2 + 0.006);
  cabinet.add(recess);
  const foot = part(block(w - 0.1, 0.08, d - 0.1, 0.01), s.rubber, false);
  foot.position.y = -0.04;
  cabinet.add(foot);
  const margin = 0.044;
  const each = (h - margin * (drawers + 1)) / drawers;
  for (let i = 0; i < drawers; i++) {
    const drawer = buildDrawer(s, w - 0.15, each, i + drawers);
    drawer.position.set(0, h - margin - each / 2 - i * (each + margin), d / 2 + 0.03);
    cabinet.add(drawer);
  }
  return cabinet;
}

function buildCrt(s: Surfaces): { crt: Group; screen: MeshStandardMaterial } {
  const crt = new Group();
  // The tube housing tapers away to the back, and the front is a heavy frame around curved glass.
  const shell = part(loft(smoothRings([
    { y: -0.96, rx: 0.4, rz: 0.32, n: 5, z: -0.02 },
    { y: -0.72, rx: 0.5, rz: 0.4, n: 5, z: -0.02 },
    { y: -0.4, rx: 0.68, rz: 0.54, n: 6, z: 0 },
    { y: -0.2, rx: 0.76, rz: 0.6, n: 7, z: 0 },
  ], 3), 56), s.plastic);
  shell.rotation.x = Math.PI / 2;
  shell.position.set(0, 0.74, 0);
  crt.add(shell);
  const frame = part(block(1.62, 1.28, 0.24, 0.05), s.plastic);
  frame.position.set(0, 0.74, 0.12);
  crt.add(frame);
  const glass = (x: number, y: number): number => 0.24 + 0.05 * (1 - (x / 0.72) ** 2) * (1 - (y / 0.56) ** 2);
  const lip = part(plate(densify(roundedRect(1.36, 1.02, 0.12, 6), 5), glass, { lift: 0.002, edge: 0.03, rings: 8 }), s.joint, false);
  lip.position.set(0, 0.8, 0);
  crt.add(lip);
  const screen = new MeshStandardMaterial({ color: '#05080e', roughness: 0.34, metalness: 0.1, emissive: '#123626', emissiveIntensity: 0.4 });
  const tubeFace = part(plate(densify(roundedRect(1.26, 0.92, 0.1, 6), 5), glass, { lift: 0.01, edge: 0.01, rings: 14 }), screen, false);
  tubeFace.position.set(0, 0.8, 0);
  crt.add(tubeFace);
  for (const x of [0.48, 0.6]) {
    const knob = part(new CylinderGeometry(0.038, 0.042, 0.04, 18), s.joint, false);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, 0.2, 0.25);
    crt.add(knob);
  }
  const stand = part(block(0.86, 0.1, 0.8, 0.03), s.plastic);
  stand.position.set(0, 0.05, -0.1);
  crt.add(stand);
  return { crt, screen };
}

function buildLamp(s: Surfaces): Group {
  const lamp = new Group();
  const base = part(loft(roundedProfile(0.03, 0.26, 0.26, 0.02, 2, 3), 32), s.joint);
  base.position.y = 0.03;
  lamp.add(base);
  const arm = part(tube([
    { at: new Vector3(0, 0.03, 0), rx: 0.022 },
    { at: new Vector3(0.05, 1.0, 0), rx: 0.022 },
    { at: new Vector3(0, 1.9, 0.05), rx: 0.022 },
    { at: new Vector3(-0.42, 2.34, 0.12), rx: 0.022 },
    { at: new Vector3(-0.86, 2.3, 0.2), rx: 0.022 },
  ], 10, 8), s.gunmetal);
  lamp.add(arm);
  const head = new Group();
  head.position.set(-0.98, 2.2, 0.22);
  head.rotation.set(0.32, 0, 0.72);
  const shade = part(loft([
    { y: -0.24, rx: 0.32, rz: 0.32 },
    { y: -0.22, rx: 0.315, rz: 0.315 },
    { y: -0.04, rx: 0.2, rz: 0.2 },
    { y: 0.12, rx: 0.11, rz: 0.11 },
    { y: 0.16, rx: 0.07, rz: 0.07 },
  ], 36), s.gunmetal);
  head.add(shade);
  const bulb = new Mesh(new CylinderGeometry(0.15, 0.15, 0.015, 24), new MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false }));
  bulb.position.y = -0.2;
  head.add(bulb);
  const glow = new Sprite(new SpriteMaterial({ map: softGlow('rgba(255,190,120,0.8)', 'rgba(255,130,50,0.22)'), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  glow.scale.set(1.5, 1.5, 1);
  glow.position.y = -0.3;
  head.add(glow);
  lamp.add(head);
  return lamp;
}

// The skyline from the pixel office, far away and very faint.
function buildCity(): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 2048, 512);
  let seed = 19;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let x = 0; x < 2048;) {
    const w = 46 + random() * 90;
    const h = 90 + random() * 260;
    ctx.fillStyle = random() > 0.5 ? '#10183a' : '#0e1633';
    ctx.fillRect(x, 512 - h, w, h);
    for (let wy = 512 - h + 8; wy < 500; wy += 11) {
      for (let wx = x + 6; wx < x + w - 6; wx += 9) {
        if (random() < 0.13) {
          ctx.fillStyle = random() > 0.3 ? 'rgba(255,176,84,0.8)' : 'rgba(120,150,220,0.5)';
          ctx.fillRect(wx, wy, 3, 4);
        }
      }
    }
    x += w + random() * 8;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const city = new Mesh(new PlaneGeometry(64, 16), new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.42, toneMapped: false, depthWrite: false }));
  city.position.set(0, 3.2, -26);
  return city;
}

function buildRain(): { rain: LineSegments; step(dt: number): void } {
  const count = 240;
  const position = new Float32Array(count * 6);
  const speed = new Float32Array(count);
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    const x = (random() - 0.5) * 30;
    const y = random() * 16 - 3;
    const z = -8 + random() * 3;
    const length = 0.24 + random() * 0.3;
    position.set([x, y, z, x - length * 0.05, y - length, z], i * 6);
    speed[i] = 1.6 + random() * 1.8;
  }
  const geometry = new BufferGeometry();
  const attribute = new BufferAttribute(position, 3);
  geometry.setAttribute('position', attribute);
  const rain = new LineSegments(geometry, new LineBasicMaterial({ color: '#3a4a78', transparent: true, opacity: 0.42, toneMapped: false, depthWrite: false }));
  rain.frustumCulled = false;
  const step = (dt: number): void => {
    for (let i = 0; i < count; i++) {
      const fall = (speed[i] as number) * dt;
      position[i * 6 + 1] = (position[i * 6 + 1] as number) - fall;
      position[i * 6 + 4] = (position[i * 6 + 4] as number) - fall;
      if ((position[i * 6 + 4] as number) < -4) {
        position[i * 6 + 1] = (position[i * 6 + 1] as number) + 17;
        position[i * 6 + 4] = (position[i * 6 + 4] as number) + 17;
      }
    }
    attribute.needsUpdate = true;
  };
  return { rain, step };
}

export interface Stage { group: Object3D; step(dt: number): void; crtScreen: MeshStandardMaterial }

export function buildStage(scene: Scene, s: Surfaces, robot: Object3D): Stage {
  const group = new Group();
  scene.add(group);

  const main = buildCabinet(s, CABINET.w, CABINET.h, CABINET.d, 4, [[-0.55, 0.62, 0.34, 0.08], [0.5, -0.7, 0.26, 0.07], [0.82, 0.3, 0.18, 0.05], [-0.9, -0.5, 0.2, 0.05]]);
  group.add(main);
  robot.position.set(0, CABINET.h + 0.05, 0.05);
  group.add(robot);

  const side = buildCabinet(s, CRT_STAND.w, CRT_STAND.h, CRT_STAND.d, 2, [[0.3, 0.2, 0.26, 0.04]]);
  side.position.set(CRT_STAND.x, 0, -0.5);
  side.rotation.y = -0.16;
  group.add(side);
  const { crt, screen } = buildCrt(s);
  crt.position.set(CRT_STAND.x - 0.1, CRT_STAND.h + 0.05, -0.56);
  crt.rotation.y = -0.3;
  group.add(crt);
  const lamp = buildLamp(s);
  lamp.position.set(CRT_STAND.x + 0.72, CRT_STAND.h + 0.05, 0.02);
  group.add(lamp);

  const city = buildCity();
  group.add(city);
  const { rain, step } = buildRain();
  group.add(rain);

  // The middle guide line lives in the scene, so it passes behind the robot rather than across its face.
  const guide = new BufferGeometry();
  guide.setAttribute('position', new BufferAttribute(new Float32Array([0, -6, -4, 0, 24, -4]), 3));
  group.add(new LineSegments(guide, new LineBasicMaterial({ color: '#aeb8c8', transparent: true, opacity: 0.1, toneMapped: false, depthWrite: false })));

  // The glow behind the head, from the PFP.
  const halo = new Sprite(new SpriteMaterial({ map: softGlow('rgba(255,140,50,0.7)', 'rgba(255,110,30,0.22)'), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  halo.scale.set(4.8, 4.8, 1);
  halo.position.set(0, CABINET.h + 3.7, -1.2);
  group.add(halo);

  const key = new SpotLight('#ffb27a', 92, 22, 0.5, 0.8, 1.7);
  key.position.set(5.4, CABINET.h + 7.4, 4.6);
  key.target.position.set(0, CABINET.h + 2.1, 0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.04;
  key.shadow.radius = 4;
  group.add(key, key.target);

  const wash = new PointLight('#ff9a4a', 26, 9, 1.8);
  wash.position.set(CRT_STAND.x - 0.6, CRT_STAND.h + 1.95, 1.0);
  group.add(wash);

  const rim = new DirectionalLight('#7fa8ff', 3.1);
  rim.position.set(-6, 8, -7);
  group.add(rim);
  const rimLow = new DirectionalLight('#5a7fd8', 1.1);
  rimLow.position.set(-7, 1, 3);
  group.add(rimLow);
  group.add(new HemisphereLight(new Color('#26355f'), new Color('#0b1020'), 1.5));
  return { group, step, crtScreen: screen };
}
