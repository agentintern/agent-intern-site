import {
  AdditiveBlending, BufferAttribute, type BufferGeometry, CanvasTexture, Group, LatheGeometry, type Material, Mesh, MeshPhysicalMaterial,
  Sprite, SpriteMaterial, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { GLYPHS } from '../../shared/font';
import type { RobotState } from '../../shared/robot';
import { densify, loft, plate, roundedProfile, roundedRect, smooth, smoothRings, tube, wobble, type Ring, type Surface } from './shapes';
import { softGlow, type Surfaces } from './surfaces';
import { VisorScreen, type Tint } from './visor';

export const HIP_HEIGHT = 1.58;
export const ROBOT_TOP = 4.35;

const HEAD = { half: 0.5, rx: 0.62, rz: 0.5, n: 5, edge: 0.17 };
const headTaper = (y: number): number => 1 - 0.055 * (1 - smooth(-0.5, 0.12, y));

function headSurface(x: number, y: number): number {
  const over = Math.max(0, Math.abs(y) - (HEAD.half - HEAD.edge));
  const inset = HEAD.edge - Math.sqrt(Math.max(0, HEAD.edge ** 2 - over ** 2));
  const k = headTaper(y);
  const rx = (HEAD.rx - inset) * k;
  const rz = (HEAD.rz - inset) * k;
  return rz * Math.max(0, 1 - Math.abs(x / rx) ** HEAD.n) ** (1 / HEAD.n);
}

const TORSO_RINGS = smoothRings([
  { y: -0.02, rx: 0.5, rz: 0.31, n: 2.4 },
  { y: 0.06, rx: 0.55, rz: 0.345, n: 2.4 },
  { y: 0.16, rx: 0.56, rz: 0.35, n: 2.4 },
  { y: 0.42, rx: 0.55, rz: 0.345, n: 2.5 },
  { y: 0.72, rx: 0.62, rz: 0.375, n: 2.6 },
  { y: 0.97, rx: 0.71, rz: 0.395, n: 2.7 },
  { y: 1.1, rx: 0.75, rz: 0.37, n: 2.7 },
  { y: 1.2, rx: 0.71, rz: 0.31, n: 2.5 },
  { y: 1.29, rx: 0.5, rz: 0.26, n: 2.3 },
  { y: 1.36, rx: 0.28, rz: 0.21, n: 2.2 },
  { y: 1.39, rx: 0.17, rz: 0.17, n: 2.1 },
], 8);

function torsoRing(y: number): Ring {
  let a = TORSO_RINGS[0] as Ring;
  for (const ring of TORSO_RINGS) {
    if (ring.y > y) {
      const t = (y - a.y) / Math.max(1e-4, ring.y - a.y);
      return { y, rx: a.rx + (ring.rx - a.rx) * t, rz: a.rz + (ring.rz - a.rz) * t, n: (a.n ?? 2) + ((ring.n ?? 2) - (a.n ?? 2)) * t };
    }
    a = ring;
  }
  return a;
}

const chestSurface: Surface = (x, y) => {
  const ring = torsoRing(y);
  return ring.rz * Math.max(0, 1 - Math.abs(x / ring.rx) ** (ring.n ?? 2)) ** (1 / (ring.n ?? 2));
};

// Each crease runs from one point to another on the shirt, as an angle from the front and a height. Pulled cloth makes
// thin lines rather than soft lumps, so these are narrow valleys with a small ridge beside them.
const CREASES: [number, number, number, number, number][] = [
  [0.98, 0.98, 0.42, 0.7, 0.02], [1.06, 0.86, 0.56, 0.46, 0.022], [1.2, 0.62, 0.86, 0.24, 0.02], [0.72, 0.98, 0.3, 0.84, 0.012],
  [-1.0, 0.96, -0.46, 0.66, 0.02], [-1.1, 0.8, -0.62, 0.42, 0.022], [-1.16, 0.56, -0.8, 0.2, 0.018], [-0.7, 1.0, -0.36, 0.86, 0.012],
  [0.2, 0.3, 0.24, 0.05, 0.014], [0.5, 0.36, 0.42, 0.05, 0.018], [0.82, 0.3, 0.74, 0.05, 0.016], [1.14, 0.28, 1.1, 0.05, 0.014],
  [-0.24, 0.28, -0.2, 0.05, 0.014], [-0.56, 0.38, -0.46, 0.05, 0.018], [-0.88, 0.32, -0.8, 0.05, 0.016], [-1.2, 0.26, -1.14, 0.05, 0.014],
];

function creaseDepth(a: number, y: number): number {
  let total = 0;
  for (const [a1, y1, a2, y2, depth] of CREASES) {
    const dx = a2 - a1;
    const dy = y2 - y1;
    const along = Math.min(1, Math.max(0, ((a - a1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const across = Math.hypot(a - (a1 + dx * along), y - (y1 + dy * along));
    const fade = Math.sin(Math.PI * Math.min(1, along * 0.92 + 0.06));
    total += depth * fade * (0.5 * Math.exp(-(((across - 0.13) / 0.08) ** 2)) - Math.exp(-((across / 0.055) ** 2)));
  }
  return total;
}

function shirtFolds(angle: number, ring: Ring): number {
  const { y } = ring;
  const a = Math.atan2(Math.cos(angle), Math.sin(angle));
  const blouse = 0.022 * smooth(-0.02, 0.07, y) * (1 - smooth(0.1, 0.3, y));
  const drape = 0.008 * wobble(angle * 2.2 + 1, y * 2.6) * smooth(0, 0.2, y) * (1 - smooth(1.02, 1.2, y));
  return blouse + drape + creaseDepth(a, y) * (1 - smooth(1.06, 1.14, y));
}

// Light that the shape would really block: the valleys of the creases, the armpits, and above the belt.
function shirtShade(angle: number, ring: Ring, pushed: number): number {
  const { y } = ring;
  const side = Math.abs(Math.cos(angle));
  const folds = Math.min(1.05, Math.max(0.62, 1 + pushed * 10));
  const armpit = 1 - 0.46 * smooth(0.72, 0.97, side) * smooth(0.6, 0.86, y) * (1 - smooth(0.98, 1.1, y));
  const belt = 0.62 + 0.38 * smooth(0, 0.12, y);
  const turn = 0.84 + 0.16 * Math.max(0, Math.sin(angle));
  return folds * armpit * belt * turn;
}

function mesh(geometry: BufferGeometry, material: Material, shadow = true): Mesh {
  const part = new Mesh(geometry, material);
  part.castShadow = shadow;
  part.receiveShadow = shadow;
  return part;
}

const block = (w: number, h: number, d: number, r: number, n = 7, steps = 4): BufferGeometry =>
  loft(roundedProfile(h / 2, w / 2, d / 2, r, n, steps), 32);

const lathe = (points: [number, number][], segments = 48): LatheGeometry =>
  new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), segments);

function buildHead(s: Surfaces, screen: VisorScreen): Group {
  const head = new Group();
  const shell = mesh(loft(roundedProfile(HEAD.half, HEAD.rx, HEAD.rz, HEAD.edge, HEAD.n, 10, headTaper), 72), s.steel);
  head.add(shell);

  // The face is its own plate, so it can carry the PFP's brushing and scratches in the right places.
  head.add(mesh(plate(roundedRect(1.02, 0.76, 0.17, 10), headSurface, { lift: 0.007, edge: 0.012, rings: 10 }), s.face));

  const visorY = 0.03;
  const onVisor: Surface = (x, y) => headSurface(x, y + visorY);
  const bezel = mesh(plate(roundedRect(1.0, 0.33, 0.13, 8), onVisor, { lift: 0.024, edge: 0.02 }), s.joint, false);
  bezel.position.y = visorY;
  head.add(bezel);
  const glass = new MeshPhysicalMaterial({
    color: '#05070d', metalness: 0.2, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06,
    emissive: '#ffffff', emissiveMap: screen.texture, emissiveIntensity: 1.7,
  });
  const dome: Surface = (x, y) => onVisor(x, y) + 0.012 * (1 - (x / 0.48) ** 2) * (1 - (y / 0.14) ** 2);
  const lens = mesh(plate(roundedRect(0.95, 0.276, 0.1, 8), dome, { lift: 0.03, edge: 0.012, rings: 12 }), glass, false);
  lens.position.y = visorY;
  head.add(lens);

  // Bloom around each eye, drawn as light so it doesn't need a post-processing pass.
  const bloom = softGlow('rgba(255,170,90,0.55)', 'rgba(255,110,30,0.16)');
  for (const x of [-0.22, 0.22]) {
    const sprite = new Sprite(new SpriteMaterial({ map: bloom, blending: AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    sprite.scale.set(0.74, 0.42, 1);
    sprite.position.set(x, visorY, HEAD.rz + 0.1);
    head.add(sprite);
  }

  // The stepped cups on each side of the PFP's head.
  for (const side of [-1, 1]) {
    const ear = new Group();
    ear.add(mesh(lathe([[0, 0], [0.285, 0], [0.285, 0.035], [0.27, 0.05], [0.262, 0.1], [0.24, 0.112], [0, 0.112]]), s.steel));
    ear.add(mesh(lathe([[0.2, 0.1], [0.2, 0.135], [0.19, 0.148], [0, 0.148]]), s.gunmetal));
    ear.add(mesh(lathe([[0.125, 0.14], [0.125, 0.165], [0.11, 0.176], [0, 0.178]]), s.steel));
    ear.rotation.z = -side * (Math.PI / 2);
    ear.position.set(side * (HEAD.rx - 0.05), 0.02, 0);
    head.add(ear);
  }

  // A low vent on top, where the pixel robot has its stub.
  const vent = mesh(block(0.42, 0.06, 0.26, 0.022), s.gunmetal);
  vent.position.set(0, HEAD.half + 0.015, -0.02);
  head.add(vent);
  for (const x of [-0.12, -0.04, 0.04, 0.12]) {
    const slot = mesh(block(0.042, 0.02, 0.19, 0.008), s.rubber, false);
    slot.position.set(x, HEAD.half + 0.04, -0.02);
    head.add(slot);
  }
  return head;
}

function buildHand(s: Surfaces, side: number): Group {
  const hand = new Group();
  const palm = mesh(block(0.2, 0.2, 0.11, 0.04), s.steel);
  palm.position.y = -0.1;
  hand.add(palm);
  [-0.066, 0, 0.066].forEach((x, i) => {
    const length = 0.12 - Math.abs(i - 1) * 0.015;
    const finger = mesh(tube([
      { at: new Vector3(x, -0.18, 0), rx: 0.03 },
      { at: new Vector3(x, -0.2 - length * 0.55, 0.012), rx: 0.03 },
      { at: new Vector3(x, -0.2 - length, 0.04), rx: 0.024 },
    ], 8, 3), s.steel, false);
    hand.add(finger);
  });
  const thumb = mesh(tube([
    { at: new Vector3(-side * 0.09, -0.07, 0.03), rx: 0.034 },
    { at: new Vector3(-side * 0.13, -0.14, 0.05), rx: 0.03 },
    { at: new Vector3(-side * 0.125, -0.19, 0.075), rx: 0.024 },
  ], 8, 3), s.steel, false);
  hand.add(thumb);
  return hand;
}

interface Arm { shoulder: Group; elbow: Group }

function buildArm(s: Surfaces, side: number): Arm {
  const shoulder = new Group();
  const sleeve = mesh(tube([
    { at: new Vector3(-side * 0.1, 0.08, 0), rx: 0.14, rz: 0.14 },
    { at: new Vector3(-side * 0.05, 0.0, 0), rx: 0.22, rz: 0.2 },
    { at: new Vector3(0, -0.16, 0), rx: 0.25, rz: 0.228, n: 2.2 },
    { at: new Vector3(0, -0.34, 0), rx: 0.25, rz: 0.23, n: 2.2 },
    { at: new Vector3(0, -0.5, 0), rx: 0.255, rz: 0.235, n: 2.2 },
  ], 32, 7), s.shirt);
  shoulder.add(sleeve);
  const cuff = mesh(loft(smoothRings([
    { y: -0.6, rx: 0.255, rz: 0.235, n: 2.2 },
    { y: -0.592, rx: 0.272, rz: 0.252, n: 2.2 },
    { y: -0.55, rx: 0.276, rz: 0.256, n: 2.2 },
    { y: -0.5, rx: 0.274, rz: 0.254, n: 2.2 },
    { y: -0.488, rx: 0.258, rz: 0.238, n: 2.2 },
  ], 3), 36), s.shirt);
  shoulder.add(cuff);
  const shade = mesh(block(0.49, 0.02, 0.45, 0.01, 2.2, 2), s.joint, false);
  shade.position.y = -0.6;
  shoulder.add(shade);

  const upper = mesh(lathe([[0, -0.82], [0.118, -0.8], [0.118, -0.74], [0.13, -0.73], [0.13, -0.69], [0.118, -0.68], [0.118, -0.62], [0, -0.6]].reverse() as [number, number][], 28), s.joint);
  shoulder.add(upper);

  const elbow = new Group();
  elbow.position.y = -0.84;
  const knuckle = mesh(block(0.27, 0.2, 0.25, 0.09, 2.4, 6), s.joint);
  elbow.add(knuckle);
  const forearm = mesh(tube([
    { at: new Vector3(0, -0.06, 0), rx: 0.118, rz: 0.11 },
    { at: new Vector3(0, -0.22, 0), rx: 0.128, rz: 0.118, n: 2.3 },
    { at: new Vector3(0, -0.42, 0), rx: 0.11, rz: 0.1, n: 2.3 },
    { at: new Vector3(0, -0.52, 0), rx: 0.096, rz: 0.088 },
  ], 24, 5), s.steel);
  elbow.add(forearm);
  const wrist = mesh(lathe([[0, -0.6], [0.075, -0.59], [0.075, -0.525], [0, -0.515]].reverse() as [number, number][], 20), s.joint);
  elbow.add(wrist);
  const hand = buildHand(s, side);
  hand.position.y = -0.58;
  hand.rotation.set(0.1, side * 0.2, 0);
  elbow.add(hand);
  shoulder.add(elbow);
  return { shoulder, elbow };
}

function buildLeg(s: Surfaces, side: number): Group {
  const leg = new Group();
  const cloth = mesh(tube([
    { at: new Vector3(0, -0.06, 0), rx: 0.282, rz: 0.3, n: 2.3 },
    { at: new Vector3(0, -0.34, 0), rx: 0.287, rz: 0.31, n: 2.3 },
    { at: new Vector3(side * 0.01, -0.84, 0.012), rx: 0.228, rz: 0.238 },
    { at: new Vector3(side * 0.02, -1.28, 0), rx: 0.2, rz: 0.21 },
    { at: new Vector3(side * 0.02, -1.4, 0), rx: 0.205, rz: 0.222 },
  ], 32, 7), s.trousers);
  leg.add(cloth);
  const ankle = mesh(lathe([[0, -1.5], [0.095, -1.49], [0.095, -1.36], [0, -1.35]].reverse() as [number, number][], 18), s.joint);
  ankle.position.x = side * 0.02;
  leg.add(ankle);

  const shoe = new Group();
  shoe.position.set(side * 0.03, -HIP_HEIGHT, 0);
  shoe.rotation.y = side * 0.12;
  const upper = mesh(tube([
    { at: new Vector3(0, 0.16, -0.27), rx: 0.15, rz: 0.1, n: 2.6 },
    { at: new Vector3(0, 0.15, -0.14), rx: 0.2, rz: 0.15, n: 3 },
    { at: new Vector3(0, 0.15, 0.1), rx: 0.2, rz: 0.13, n: 3 },
    { at: new Vector3(0, 0.125, 0.32), rx: 0.2, rz: 0.1, n: 3.4 },
    { at: new Vector3(0, 0.115, 0.43), rx: 0.15, rz: 0.075, n: 2.8 },
  ], 28, 6), s.steel);
  shoe.add(upper);
  const sole = mesh(block(0.42, 0.06, 0.78, 0.022, 4), s.rubber);
  sole.position.set(0, 0.03, 0.08);
  shoe.add(sole);
  leg.add(shoe);
  return leg;
}

// A hanging strip that can swing. Its rest shape follows the chest, and only the lower part moves.
class Swinging {
  private readonly rest: Float32Array;
  private readonly weights: Float32Array;
  private readonly position: BufferAttribute;

  constructor(private readonly geometry: BufferGeometry, top: number, bottom: number) {
    this.position = geometry.getAttribute('position') as BufferAttribute;
    this.rest = Float32Array.from(this.position.array);
    this.weights = new Float32Array(this.position.count);
    for (let i = 0; i < this.position.count; i++) {
      const v = Math.min(1, Math.max(0, (top - this.position.getY(i)) / (top - bottom)));
      this.weights[i] = v * v;
    }
  }

  bend(x: number, z: number): void {
    const { rest, weights, position } = this;
    for (let i = 0; i < position.count; i++) {
      const w = weights[i] as number;
      position.setXYZ(i, (rest[i * 3] as number) + x * w, rest[i * 3 + 1] as number, (rest[i * 3 + 2] as number) + z * w * (z > 0 ? 1 : 0));
    }
    position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

class Spring {
  value = 0;
  speed = 0;
  step(dt: number, push: number, stiffness: number, damping: number): number {
    this.speed += (push - this.value * stiffness - this.speed * damping) * dt;
    this.value += this.speed * dt;
    return this.value;
  }
}

function buildChest(s: Surfaces, chest: Group): { tie: Swinging; badge: Group } {
  chest.add(mesh(loft(TORSO_RINGS, 136, (angle, ring) => shirtFolds(angle, ring), shirtShade), s.shirtFolded));

  // The collar stands around the neck and folds down to two crisp points, as on the PFP.
  chest.add(mesh(loft(smoothRings([
    { y: 1.26, rx: 0.3, rz: 0.262, n: 2.2 },
    { y: 1.36, rx: 0.288, rz: 0.25, n: 2.2 },
    { y: 1.45, rx: 0.268, rz: 0.235, n: 2.2 },
    { y: 1.47, rx: 0.25, rz: 0.216, n: 2.2 },
  ], 3), 48), s.shirt));
  const collarSurface: Surface = (x, y) => {
    const onChest = chestSurface(x, y);
    const aroundNeck = 0.255 * Math.sqrt(Math.max(0, 1 - (x / 0.33) ** 2));
    return Math.max(onChest, aroundNeck) + 0.03 + 0.06 * smooth(1.06, 1.3, y) + 0.02 * smooth(0.12, 0.42, Math.abs(x));
  };
  for (const side of [-1, 1]) {
    const wing: [number, number][] = [[0.008, 1.2], [0.25, 1.44], [0.33, 1.34], [0.46, 1.19], [0.25, 0.97], [0.05, 1.15]].map(([x, y]) => [side * (x as number), y as number]);
    chest.add(mesh(plate(densify(wing, 6), collarSurface, { lift: 0.016, edge: 0.05, rings: 6, uvScale: [1, 1] }), s.shirt));
  }

  // The pocket from the PFP, on the same side.
  const pocket: [number, number][] = [[0.19, 0.96], [0.5, 0.96], [0.5, 0.72], [0.46, 0.67], [0.23, 0.67], [0.19, 0.72]];
  chest.add(mesh(plate(densify(pocket, 8), chestSurface, { lift: 0.012, edge: 0.03, rings: 6, uvScale: [1, 1] }), s.shirt));

  // The tie: a knot, and a wide blade that follows the chest and swings at the tip.
  const knotOutline = densify([[0.1, 1.22], [0.05, 1.07], [-0.05, 1.07], [-0.1, 1.22]], 6);
  const knot = mesh(plate(knotOutline, (x, y) => chestSurface(x, y) + 0.1 * (1 - (x / 0.13) ** 2), { lift: 0.05, edge: 0.09, rings: 5, uvScale: [2, 2] }), s.tie);
  chest.add(knot);

  const widths: [number, number][] = [[1.1, 0.044], [0.92, 0.085], [0.6, 0.13], [0.36, 0.158], [0.25, 0.165]];
  const rightSide: [number, number][] = [];
  for (let i = 0; i < widths.length - 1; i++) {
    const [y1, w1] = widths[i] as [number, number];
    const [y2, w2] = widths[i + 1] as [number, number];
    for (let k = 0; k < 6; k++) rightSide.push([w1 + ((w2 - w1) * k) / 6, y1 + ((y2 - y1) * k) / 6]);
  }
  const outline: [number, number][] = [
    ...rightSide.map(([x, y]) => [-x, y] as [number, number]),
    [-0.165, 0.25], [-0.082, 0.175], [0, 0.09], [0.082, 0.175], [0.165, 0.25],
    ...[...rightSide].reverse(),
  ];
  const blade = plate(outline, (x, y) => chestSurface(0, y) * 0.6 + chestSurface(x, y) * 0.4 + 0.018 * Math.cos(x * 14), { lift: 0.04, edge: 0.04, rings: 8, uvScale: [1.6, 1.6], center: [0, 0.62] });
  const bladeMesh = mesh(blade, s.tie);
  chest.add(bladeMesh);

  // The lanyard and the blank badge hang from a point behind the collar, and swing as one piece.
  const badge = new Group();
  badge.position.set(0, 1.26, 0);
  chest.add(badge);
  const clipY = 0.72 - 1.26;
  const front = (y: number): number => chestSurface(0, y + 1.26) * 0.98 + 0.075;
  for (const side of [-1, 1]) {
    const cord = mesh(tube([
      { at: new Vector3(side * 0.3, 1.1 - 1.26, chestSurface(0.3, 1.1) + 0.02), rx: 0.0125 },
      { at: new Vector3(side * 0.235, 0.98 - 1.26, chestSurface(0.235, 0.98) + 0.026), rx: 0.0125 },
      { at: new Vector3(side * 0.13, 0.84 - 1.26, front(0.84 - 1.26) - 0.006), rx: 0.0125 },
      { at: new Vector3(side * 0.012, clipY + 0.03, front(clipY) + 0.004), rx: 0.0125 },
    ], 6, 6), s.cord, false);
    badge.add(cord);
  }
  const hook = mesh(block(0.05, 0.11, 0.024, 0.01), s.steel, false);
  hook.position.set(0, clipY - 0.015, front(clipY) + 0.012);
  badge.add(hook);
  const cardZ = front(clipY - 0.3) + 0.03;
  const holder = mesh(plate(roundedRect(0.3, 0.385, 0.022, 5), () => 0, { lift: 0.012, edge: 0.018, rings: 2 }), s.badge);
  holder.position.set(0, clipY - 0.265, cardZ);
  badge.add(holder);
  const card = mesh(plate(roundedRect(0.25, 0.285, 0.01, 3), () => 0, { lift: 0.016, edge: 0.002, rings: 2 }), s.paper, false);
  card.position.set(0, clipY - 0.285, cardZ);
  badge.add(card);
  const slot = mesh(block(0.075, 0.02, 0.012, 0.006, 4, 2), s.rubber, false);
  slot.position.set(0, clipY - 0.112, cardZ + 0.016);
  badge.add(slot);

  return { tie: new Swinging(blade, 1.0, 0.09), badge };
}

// Where every joint wants to be. The robot eases between these, so a change of mood reads as a movement.
interface Pose {
  headX: number; headY: number; headZ: number; chestX: number;
  rightX: number; rightZ: number; rightElbowX: number; rightElbowZ: number;
  leftX: number; leftZ: number; leftElbowX: number; leftElbowZ: number;
}

const REST: Pose = {
  headX: 0.05, headY: 0.1, headZ: 0.1, chestX: 0.02,
  rightX: -0.05, rightZ: -0.34, rightElbowX: -0.34, rightElbowZ: 0.26,
  leftX: 0.05, leftZ: 0.31, leftElbowX: -0.16, leftElbowZ: -0.22,
};

const POSES = {
  rest: REST,
  asleep: { ...REST, headX: 0.44, headY: -0.05, headZ: 0.14, chestX: 0.1, rightX: 0.03, rightZ: -0.27, rightElbowX: -0.1, rightElbowZ: 0.12, leftX: 0.03, leftZ: 0.26, leftElbowX: -0.08, leftElbowZ: -0.1 },
  typing: { ...REST, headX: 0.2, headY: 0, headZ: 0.02, chestX: 0.05, rightX: -0.2, rightZ: -0.2, rightElbowX: -1.22, rightElbowZ: 0.3, leftX: -0.2, leftZ: 0.2, leftElbowX: -1.22, leftElbowZ: -0.3 },
  thinking: { ...REST, headX: -0.08, headY: 0.34, headZ: -0.1, leftX: -0.5, leftZ: 0.34, leftElbowX: -1.86, leftElbowZ: -0.5 },
  worried: { ...REST, headX: 0.16, headY: 0, headZ: 0, chestX: 0.08, rightX: -0.42, rightZ: -0.2, rightElbowX: -1.1, rightElbowZ: 0.64, leftX: -0.42, leftZ: 0.2, leftElbowX: -1.1, leftElbowZ: -0.64 },
  cheer: { ...REST, headX: -0.22, headY: 0, headZ: 0, chestX: -0.04, rightX: 0, rightZ: -2.6, rightElbowX: -0.2, rightElbowZ: -0.1, leftX: 0, leftZ: 2.6, leftElbowX: -0.2, leftElbowZ: 0.1 },
  refusing: { ...REST, headX: -0.03, headY: 0, headZ: 0, chestX: 0, rightX: -0.72, rightZ: -0.1, rightElbowX: -1.62, rightElbowZ: 0.9, leftX: -0.56, leftZ: 0.1, leftElbowX: -1.62, leftElbowZ: -0.9 },
  salute: { ...REST, headX: 0, headY: 0, headZ: 0, rightX: -0.3, rightZ: -1.34, rightElbowX: -1.5, rightElbowZ: 1.06 },
  tie: { ...REST, headX: 0.26, headY: -0.12, headZ: 0.04, leftX: -0.66, leftZ: 0.12, leftElbowX: -1.86, leftElbowZ: -0.74 },
  shrug: { ...REST, headX: 0.04, headY: 0, headZ: 0.2, rightX: -0.1, rightZ: -0.5, rightElbowX: -1.5, rightElbowZ: -0.72, leftX: -0.1, leftZ: 0.5, leftElbowX: -1.5, leftElbowZ: 0.72 },
} satisfies Record<string, Pose>;

type PoseName = keyof typeof POSES;

interface Style { pose: PoseName; open: number; brightness: number; tint: Tint; breathRate: number; breathSize: number; shake: number; scan: boolean }

// What each state in src/shared/robot.ts looks like. Nothing else decides how the robot feels.
const STYLES: Record<RobotState, Style> = {
  asleep: { pose: 'asleep', open: 0.14, brightness: 0.45, tint: 'orange', breathRate: 0.66, breathSize: 1.8, shake: 0, scan: false },
  working: { pose: 'typing', open: 1, brightness: 1, tint: 'orange', breathRate: 1.15, breathSize: 1, shake: 0, scan: true },
  thinking: { pose: 'thinking', open: 0.82, brightness: 1, tint: 'orange', breathRate: 1, breathSize: 1, shake: 0, scan: true },
  stuck: { pose: 'worried', open: 1, brightness: 1, tint: 'red', breathRate: 2.2, breathSize: 1, shake: 1, scan: false },
  panicking: { pose: 'worried', open: 1, brightness: 1, tint: 'red', breathRate: 2.8, breathSize: 1.2, shake: 1.7, scan: false },
  celebrating: { pose: 'cheer', open: 1, brightness: 1, tint: 'orange', breathRate: 1.6, breathSize: 1.2, shake: 0, scan: false },
  refusing: { pose: 'refusing', open: 0.5, brightness: 1, tint: 'red', breathRate: 1, breathSize: 1, shake: 0, scan: false },
};

function zTexture(): CanvasTexture {
  const canvas = new OffscreenCanvas(64, 64);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = '#d7dfeb';
  GLYPHS.Z?.forEach((bits, row) => {
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) ctx.fillRect(8 + col * 8, 4 + row * 8, 8, 8);
    }
  });
  const texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export interface RobotInput {
  dt: number;
  time: number;
  kick: number; // How far the page just scrolled, as -1 to 1.
  aimX: number; // Where the pointer is from the robot's point of view, -1 to 1.
  aimY: number;
  near: boolean; // The pointer is close to the robot.
  turn: number; // 0 to 1, how far it has turned toward the CRT.
  raise: number; // 0 to 1, how far a sleeping head lifts for the close-up.
  lookDown: number; // 0 to 1, how far it looks down at the drawers.
  text: string; // Words for the visor, if any.
  textMix: number;
}

export interface Robot {
  root: Group;
  headAnchor: Group;
  update(input: RobotInput): void;
  setMood(mood: RobotState): void;
  poke(): void;
  hold(pose: PoseName | null): void;
  settle(): void;
}

export function buildRobot(s: Surfaces): Robot {
  const screen = new VisorScreen();
  const root = new Group();
  const pelvis = new Group();
  pelvis.position.y = HIP_HEIGHT;
  root.add(pelvis);

  const belt = mesh(loft(smoothRings([
    { y: -0.13, rx: 0.555, rz: 0.345, n: 2.4 },
    { y: -0.12, rx: 0.572, rz: 0.362, n: 2.4 },
    { y: 0.0, rx: 0.572, rz: 0.362, n: 2.4 },
    { y: 0.012, rx: 0.555, rz: 0.345, n: 2.4 },
  ], 2), 72), s.joint);
  pelvis.add(belt);
  const buckle = mesh(block(0.15, 0.085, 0.03, 0.012), s.steel);
  buckle.position.set(0, -0.06, 0.362);
  pelvis.add(buckle);

  const chest = new Group();
  pelvis.add(chest);
  const { tie, badge } = buildChest(s, chest);

  const neck = new Group();
  neck.position.y = 1.4;
  chest.add(neck);
  neck.add(mesh(lathe([
    [0, -0.08], [0.205, -0.08], [0.205, 0.02], [0.17, 0.03], [0.17, 0.05], [0.198, 0.06], [0.198, 0.1], [0.17, 0.11],
    [0.17, 0.13], [0.198, 0.14], [0.198, 0.18], [0.17, 0.19], [0.17, 0.21], [0, 0.21],
  ], 36), s.joint));
  neck.add(mesh(lathe([[0.215, 0.21], [0.215, 0.255], [0.2, 0.265], [0, 0.265]], 36), s.gunmetal));
  const head = buildHead(s, screen);
  const headPivot = new Group();
  headPivot.position.y = 0.25;
  head.position.y = 0.49;
  headPivot.add(head);
  neck.add(headPivot);
  const headAnchor = new Group();
  head.add(headAnchor);

  const [right, left] = [-1, 1].map((side) => {
    const arm = buildArm(s, side);
    arm.shoulder.position.set(side * 0.66, 0.99, 0);
    chest.add(arm.shoulder);
    return arm;
  }) as [Arm, Arm];

  const [legRight, legLeft] = [-1, 1].map((side) => {
    const leg = buildLeg(s, side);
    leg.position.set(side * 0.27, 0, 0);
    pelvis.add(leg);
    return leg;
  }) as [Group, Group];

  // The Z's float up from the head while it sleeps.
  const zMap = zTexture();
  const zs = [0, 1, 2].map(() => {
    const sprite = new Sprite(new SpriteMaterial({ map: zMap, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    root.add(sprite);
    return sprite;
  });

  const tieX = new Spring();
  const tieZ = new Spring();
  const badgeSwing = new Spring();
  const now: Pose = { ...POSES.asleep };
  let mood: RobotState = 'asleep';
  let held: PoseName | null = null;
  let lastSway = 0;
  let nextBlink = 2.2;
  let blinkAt = -10;
  let wake = 0;
  let wakeUntil = 0;
  let wokenByThisVisit = false;
  let gesture: PoseName | null = null;
  let gestureUntil = 0;
  let nextGesture: PoseName = 'tie';
  let clock = 0;
  let breathPhase = 0;
  let snap = true;

  const update = (input: RobotInput): void => {
    const { dt, time, kick, aimX, aimY, near, turn, raise, lookDown, text, textMix } = input;
    const step = Math.min(dt, 1 / 30);
    clock = time;
    const style = STYLES[mood];

    // Half waking: the pointer comes near, it looks up for a moment, then it nods off even if the pointer stays.
    const sleeping = mood === 'asleep' && !held;
    if (near && sleeping && !wokenByThisVisit) {
      wokenByThisVisit = true;
      wakeUntil = time + 2.8;
    }
    if (!near) wokenByThisVisit = false;
    const waking = sleeping && time < wakeUntil;
    wake += ((waking ? 1 : 0) - wake) * (1 - Math.exp(-step * (waking ? 5 : 1.6)));

    const pose = held ?? (gesture && time < gestureUntil ? gesture : style.pose);
    const target = POSES[pose];
    const ease = snap ? 1 : 1 - Math.exp(-step * (pose === 'cheer' ? 9 : 5));
    for (const key of Object.keys(now) as (keyof Pose)[]) now[key] += (target[key] - now[key]) * ease;
    snap = false;

    breathPhase += step * style.breathRate * 1.15;
    const breath = Math.sin(breathPhase);
    const size = style.breathSize;
    const weight = Math.sin(time * 0.31) * 0.6 + Math.sin(time * 0.17 + 1) * 0.4;
    const sway = weight * 0.045;
    const jitter = style.shake * (Math.sin(time * 41) * 0.5 + Math.sin(time * 67) * 0.5);

    pelvis.position.x = sway + jitter * 0.012;
    pelvis.position.y = HIP_HEIGHT - Math.abs(weight) * 0.012;
    pelvis.rotation.z = -weight * 0.022;
    pelvis.rotation.y = -0.1 + 0.05 * Math.sin(time * 0.23) + turn * 0.62;
    legRight.rotation.z = -sway / 1.2 - pelvis.rotation.z;
    legLeft.rotation.z = -sway / 1.2 - pelvis.rotation.z;

    chest.rotation.z = 0.02 + weight * 0.03;
    chest.rotation.y = 0.05;
    chest.rotation.x = now.chestX + breath * 0.006 * size;
    chest.scale.set(1 + breath * 0.004 * size, 1 + breath * 0.006 * size, 1 + breath * 0.012 * size);

    // It follows the pointer fully when awake, and only as far as it has woken when asleep.
    const attention = mood === 'asleep' ? wake * 0.7 : 1;
    const lift = Math.max(wake * 0.72, raise * 0.68);
    headPivot.rotation.set(
      now.headX + (POSES.rest.headX - now.headX) * (mood === 'asleep' ? lift : 0) + Math.sin(time * 0.53) * 0.018 - aimY * 0.26 * attention + lookDown * 0.3,
      now.headY + Math.sin(time * 0.41) * 0.04 + aimX * 0.5 * attention + turn * 0.42,
      now.headZ + Math.sin(time * 0.37) * 0.018 - weight * 0.02 + jitter * 0.016,
    );

    right.shoulder.rotation.set(now.rightX + breath * 0.008, 0, now.rightZ + breath * 0.008);
    left.shoulder.rotation.set(now.leftX + breath * 0.008, 0, now.leftZ - breath * 0.008);
    const typing = pose === 'typing' ? 1 : 0;
    const wave = pose === 'cheer' ? Math.sin(time * 6) * 0.1 : 0;
    right.elbow.rotation.set(now.rightElbowX + Math.sin(time * 0.61) * 0.012 + typing * Math.sin(time * 17) * 0.045 + jitter * 0.02, 0, now.rightElbowZ + wave);
    left.elbow.rotation.set(now.leftElbowX + Math.sin(time * 0.47) * 0.012 + typing * Math.sin(time * 19 + 1.3) * 0.045 - jitter * 0.02, 0, now.leftElbowZ - wave);

    const push = (sway - lastSway) / Math.max(step, 1e-3);
    lastSway = sway;
    // A scroll hits the springs as a knock, so the tie and badge swing on after the page has stopped.
    tieX.speed += kick * 0.9;
    tieZ.speed += Math.abs(kick) * 0.5;
    badgeSwing.speed -= kick * 0.5;
    const x = tieX.step(step, -push * 9 + jitter * 0.5, 34, 2.3);
    const z = tieZ.step(step, breath * 0.04, 40, 3.4);
    // However hard the page is scrolled, the swing stays small.
    tie.bend(Math.tanh(x / 0.16) * 0.16, Math.tanh(z / 0.1) * 0.1);
    badge.rotation.z = Math.tanh(badgeSwing.step(step, push * 6, 26, 2.1) / 0.17) * 0.17;

    if (time > nextBlink) {
      blinkAt = time;
      nextBlink = time + 1.8 + ((Math.sin(time * 7.13) + 1) / 2) * 3.6;
    }
    const since = (time - blinkAt) / 0.16;
    const blink = since >= 0 && since < 1 && mood !== 'asleep' ? Math.abs(since * 2 - 1) : 1;
    const shown = held ? STYLES.working : style;
    const open = (shown.open + (0.62 - shown.open) * (mood === 'asleep' ? wake : 0)) * blink;
    screen.draw({
      open,
      look: Math.max(-1, Math.min(1, aimX * attention)),
      brightness: shown.brightness + (0.9 - shown.brightness) * wake,
      tint: shown.tint,
      scan: style.scan && !held ? (time * 0.55) % 1.2 - 0.1 : undefined,
      text,
      textMix,
    });

    const asleepLevel = sleeping ? (1 - Math.min(1, wake * 2.4)) * (1 - raise) * (1 - lookDown) * (1 - turn) : 0;
    zs.forEach((sprite, i) => {
      const age = (time * 0.26 + i / 3) % 1;
      sprite.visible = asleepLevel > 0.01;
      sprite.position.set(0.62 + age * 0.62 + Math.sin(age * 7 + i) * 0.05, 3.9 + age * 1.08, 0.3);
      const scale = 0.13 + age * 0.17;
      sprite.scale.set(scale, scale, 1);
      sprite.material.opacity = asleepLevel * Math.sin(Math.PI * age) * 0.78;
    });
  };

  update({ dt: 0, time: 0, kick: 0, aimX: 0, aimY: 0, near: false, turn: 0, raise: 0, lookDown: 0, text: '', textMix: 0 });
  return {
    root,
    headAnchor,
    update,
    setMood(next) { mood = next; },
    // A click: it straightens its tie, then salutes the next time. A sleeping robot stirs for it.
    poke() {
      gesture = nextGesture;
      gestureUntil = clock + 1.7;
      if (gesture === 'tie') tieX.speed += 0.9;
      nextGesture = nextGesture === 'tie' ? 'salute' : 'tie';
      if (mood === 'asleep') wakeUntil = clock + 2.8;
    },
    hold(pose) { held = pose; },
    settle() { snap = true; },
  };
}
