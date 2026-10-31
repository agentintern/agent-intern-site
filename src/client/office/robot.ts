import {
  AdditiveBlending, BufferAttribute, type BufferGeometry, Group, LatheGeometry, type Material, Mesh, MeshPhysicalMaterial,
  Sprite, SpriteMaterial, Vector2, Vector3,
} from 'three';
import { densify, loft, plate, roundedProfile, roundedRect, smooth, smoothRings, tube, wobble, type Ring, type Surface } from './shapes';
import { softGlow, type Surfaces } from './surfaces';
import { VisorScreen } from './visor';

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
], 14);

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
    ], 10, 4), s.steel);
    hand.add(finger);
  });
  const thumb = mesh(tube([
    { at: new Vector3(-side * 0.09, -0.07, 0.03), rx: 0.034 },
    { at: new Vector3(-side * 0.13, -0.14, 0.05), rx: 0.03 },
    { at: new Vector3(-side * 0.125, -0.19, 0.075), rx: 0.024 },
  ], 10, 4), s.steel);
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
  chest.add(mesh(loft(TORSO_RINGS, 144, (angle, ring) => shirtFolds(angle, ring), shirtShade), s.shirtFolded));

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
    ], 8, 8), s.cord);
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

export interface Robot { root: Group; screen: VisorScreen; update(dt: number, time: number, kick: number): void }

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

  const arms = [-1, 1].map((side) => {
    const arm = buildArm(s, side);
    arm.shoulder.position.set(side * 0.66, 0.99, 0);
    chest.add(arm.shoulder);
    return arm;
  });
  const [right, left] = arms as [Arm, Arm];

  const legs = [-1, 1].map((side) => {
    const leg = buildLeg(s, side);
    leg.position.set(side * 0.27, 0, 0);
    pelvis.add(leg);
    return leg;
  });
  const [legRight, legLeft] = legs as [Group, Group];

  const tieX = new Spring();
  const tieZ = new Spring();
  const badgeSwing = new Spring();
  let lastSway = 0;
  let nextBlink = 2.2;
  let blinkAt = -10;

  const update = (dt: number, time: number, kick: number): void => {
    const step = Math.min(dt, 1 / 30);
    const breath = Math.sin(time * 1.15);
    const weight = Math.sin(time * 0.31) * 0.6 + Math.sin(time * 0.17 + 1) * 0.4;
    const sway = weight * 0.045;

    pelvis.position.x = sway;
    pelvis.position.y = HIP_HEIGHT - Math.abs(weight) * 0.012;
    pelvis.rotation.z = -weight * 0.022;
    pelvis.rotation.y = -0.1 + 0.05 * Math.sin(time * 0.23);
    legRight.rotation.z = -sway / 1.2 + pelvis.rotation.z * -1;
    legLeft.rotation.z = -sway / 1.2 + pelvis.rotation.z * -1;

    chest.rotation.z = 0.02 + weight * 0.03;
    chest.rotation.y = 0.05;
    chest.rotation.x = 0.02 + breath * 0.006;
    chest.scale.set(1 + breath * 0.004, 1 + breath * 0.006, 1 + breath * 0.012);

    headPivot.rotation.set(0.05 + Math.sin(time * 0.53) * 0.018, 0.1 + Math.sin(time * 0.41) * 0.055, 0.1 + Math.sin(time * 0.37) * 0.018 - weight * 0.02);

    right.shoulder.rotation.set(-0.05 + breath * 0.008, 0, -0.34 + breath * 0.008);
    left.shoulder.rotation.set(0.05 + breath * 0.008, 0, 0.31 - breath * 0.008);
    right.elbow.rotation.set(-0.34 + Math.sin(time * 0.61) * 0.012, 0, 0.26);
    left.elbow.rotation.set(-0.16 + Math.sin(time * 0.47) * 0.012, 0, -0.22);

    const push = (sway - lastSway) / Math.max(step, 1e-3);
    lastSway = sway;
    // A scroll hits the springs as a knock, so the tie and badge swing on after the page has stopped.
    tieX.speed += kick * 0.9;
    tieZ.speed += Math.abs(kick) * 0.5;
    badgeSwing.speed -= kick * 0.5;
    const x = tieX.step(step, -push * 9, 34, 2.3);
    const z = tieZ.step(step, breath * 0.04, 40, 3.4);
    // However hard the page is scrolled, the swing stays small.
    tie.bend(Math.tanh(x / 0.16) * 0.16, Math.tanh(z / 0.1) * 0.1);
    badge.rotation.z = Math.tanh(badgeSwing.step(step, push * 6, 26, 2.1) / 0.17) * 0.17;

    if (time > nextBlink) {
      blinkAt = time;
      nextBlink = time + 1.8 + ((Math.sin(time * 7.13) + 1) / 2) * 3.6;
    }
    const since = (time - blinkAt) / 0.16;
    const open = since >= 0 && since < 1 ? Math.abs(since * 2 - 1) : 1;
    screen.draw(open);
  };

  update(0, 0, 0);
  return { root, screen, update };
}

