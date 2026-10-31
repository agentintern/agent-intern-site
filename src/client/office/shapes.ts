import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

// Every part of the robot is built here from cross-sections, so nothing starts life as a sphere or a stock box.
export interface Ring { y: number; rx: number; rz: number; x?: number; z?: number; n?: number }

type Point = [number, number];

export const smooth = (a: number, b: number, t: number): number => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// Polar superellipse: n of 2 is an ellipse, and higher is boxier with soft corners.
export const superRadius = (angle: number, rx: number, rz: number, n: number): number =>
  (Math.abs(Math.cos(angle) / Math.max(rx, 1e-4)) ** n + Math.abs(Math.sin(angle) / Math.max(rz, 1e-4)) ** n) ** (-1 / n);

const catmull = (a: number, b: number, c: number, d: number, t: number): number =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

// Passes through every ring and adds `per` rings between each pair.
export function smoothRings(rings: Ring[], per: number): Ring[] {
  const out: Ring[] = [];
  const at = (i: number): Ring => rings[Math.min(rings.length - 1, Math.max(0, i))] as Ring;
  for (let i = 0; i < rings.length - 1; i++) {
    const [p, q, r, s] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const mix = (f: (ring: Ring) => number): number => catmull(f(p), f(q), f(r), f(s), t);
      out.push({ y: mix((v) => v.y), rx: mix((v) => v.rx), rz: mix((v) => v.rz), x: mix((v) => v.x ?? 0), z: mix((v) => v.z ?? 0), n: mix((v) => v.n ?? 2) });
    }
  }
  out.push(rings[rings.length - 1] as Ring);
  return out;
}

function finish(position: number[], uv: number[], index: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// Copies the normal across the seam, so a closed surface shows no line where it starts and ends.
function weldSeam(geometry: BufferGeometry, rows: number, columns: number): void {
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  for (let i = 0; i < rows; i++) {
    const first = i * (columns + 1);
    const last = first + columns;
    const v = new Vector3().fromBufferAttribute(normal, first).add(new Vector3().fromBufferAttribute(normal, last)).normalize();
    normal.setXYZ(first, v.x, v.y, v.z);
    normal.setXYZ(last, v.x, v.y, v.z);
  }
}

export type Displace = (angle: number, ring: Ring, r: number) => number;
export type Shade = (angle: number, ring: Ring, pushed: number) => number;

// Stacks rings upward. The seam runs down the back, and UVs are in world units, so a texture never stretches.
export function loft(rings: Ring[], columns = 56, displace?: Displace, shade?: Shade): BufferGeometry {
  const position: number[] = [];
  const uv: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  let travel = 0;
  rings.forEach((ring, i) => {
    const before = rings[i - 1];
    if (before) travel += Math.hypot(ring.y - before.y, ring.rx - before.rx);
    let around = 0;
    let px = 0;
    let pz = 0;
    for (let j = 0; j <= columns; j++) {
      const angle = -Math.PI / 2 + (j / columns) * Math.PI * 2;
      const base = superRadius(angle, ring.rx, ring.rz, ring.n ?? 2);
      const pushed = displace?.(angle, ring, base) ?? 0;
      const r = base + pushed;
      if (shade) {
        const k = shade(angle, ring, pushed);
        color.push(k, k, k);
      }
      const x = (ring.x ?? 0) + Math.cos(angle) * r;
      const z = (ring.z ?? 0) + Math.sin(angle) * r;
      if (j > 0) around += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      position.push(x, ring.y, z);
      uv.push(around, travel);
    }
  });
  const row = columns + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < columns; j++) {
      const a = i * row + j;
      const b = a + row;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const capped = (ring: Ring, base: number, top: boolean): void => {
    const center = position.length / 3;
    position.push(ring.x ?? 0, ring.y, ring.z ?? 0);
    uv.push(0, 0);
    if (shade) color.push(1, 1, 1);
    for (let j = 0; j < columns; j++) {
      if (top) index.push(center, base + j + 1, base + j);
      else index.push(center, base + j, base + j + 1);
    }
  };
  capped(rings[0] as Ring, 0, false);
  capped(rings[rings.length - 1] as Ring, (rings.length - 1) * row, true);
  const geometry = finish(position, uv, index);
  weldSeam(geometry, rings.length, columns);
  if (shade) geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
  return geometry;
}

// Rounded profile for a box-like part: rings for a body of half-height h with a soft edge of radius r.
export function roundedProfile(h: number, rx: number, rz: number, r: number, n: number, steps = 8, taper: (y: number) => number = () => 1): Ring[] {
  const rings: Ring[] = [];
  const add = (y: number, inset: number): void => {
    const k = taper(y);
    rings.push({ y, rx: (rx - inset) * k, rz: (rz - inset) * k, n });
  };
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    add(-h + r - r * Math.cos(a), r - r * Math.sin(a));
  }
  const body = 14;
  for (let i = 1; i < body; i++) add(-h + r + ((2 * h - 2 * r) * i) / body, 0);
  for (let i = steps; i >= 0; i--) {
    const a = (i / steps) * (Math.PI / 2);
    add(h - r + r * Math.cos(a), r - r * Math.sin(a));
  }
  return rings;
}

export interface TubeStop { at: Vector3; rx: number; rz?: number; n?: number }

// Sweeps a section along a path. Frames are carried along, so the section never twists.
export function tube(stops: TubeStop[], columns = 24, per = 6): BufferGeometry {
  const rings: TubeStop[] = [];
  const at = (i: number): TubeStop => stops[Math.min(stops.length - 1, Math.max(0, i))] as TubeStop;
  for (let i = 0; i < stops.length - 1; i++) {
    const [p, q, r, s] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      rings.push({
        at: new Vector3(catmull(p.at.x, q.at.x, r.at.x, s.at.x, t), catmull(p.at.y, q.at.y, r.at.y, s.at.y, t), catmull(p.at.z, q.at.z, r.at.z, s.at.z, t)),
        rx: catmull(p.rx, q.rx, r.rx, s.rx, t),
        rz: catmull(p.rz ?? p.rx, q.rz ?? q.rx, r.rz ?? r.rx, s.rz ?? s.rx, t),
        n: catmull(p.n ?? 2, q.n ?? 2, r.n ?? 2, s.n ?? 2, t),
      });
    }
  }
  rings.push(stops[stops.length - 1] as TubeStop);

  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let normal = new Vector3(1, 0, 0);
  let travel = 0;
  rings.forEach((ring, i) => {
    const next = (rings[i + 1] ?? ring).at;
    const prev = (rings[i - 1] ?? ring).at;
    const tangent = next.clone().sub(prev).normalize();
    normal = normal.clone().sub(tangent.clone().multiplyScalar(normal.dot(tangent))).normalize();
    const side = tangent.clone().cross(normal).normalize();
    travel += i > 0 ? ring.at.distanceTo(prev) : 0;
    for (let j = 0; j <= columns; j++) {
      const angle = (j / columns) * Math.PI * 2;
      const r = superRadius(angle, ring.rx, ring.rz ?? ring.rx, ring.n ?? 2);
      const v = ring.at.clone().addScaledVector(normal, Math.cos(angle) * r).addScaledVector(side, Math.sin(angle) * r);
      position.push(v.x, v.y, v.z);
      uv.push((j / columns) * (ring.rx + (ring.rz ?? ring.rx)) * Math.PI, travel);
    }
  });
  const row = columns + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < columns; j++) {
      const a = i * row + j;
      const b = a + row;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  for (const [ring, flip] of [[rings[0] as TubeStop, true], [rings[rings.length - 1] as TubeStop, false]] as const) {
    const center = position.length / 3;
    const base = (ring === rings[0] ? 0 : rings.length - 1) * row;
    position.push(ring.at.x, ring.at.y, ring.at.z);
    uv.push(0, 0);
    for (let j = 0; j < columns; j++) {
      if (flip) index.push(center, base + j + 1, base + j);
      else index.push(center, base + j, base + j + 1);
    }
  }
  const geometry = finish(position, uv, index);
  weldSeam(geometry, rings.length, columns);
  return geometry;
}

export function roundedRect(w: number, h: number, r: number, seg = 8): Point[] {
  const out: Point[] = [];
  const corners: [number, number, number][] = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 1], [-w / 2 + r, -h / 2 + r, 2], [w / 2 - r, -h / 2 + r, 3]];
  for (const [cx, cy, quarter] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = ((quarter + i / seg) * Math.PI) / 2;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

export type Surface = (x: number, y: number) => number;

export interface PlateOptions { lift?: number; edge?: number; rings?: number; center?: Point; uvScale?: Point }

// A flat-ish part that lies on a curved surface: a collar, a pocket, a visor, a tie. It's a fan of rings toward the
// middle, so it follows the curve across its whole area, with a thin wall around it that catches the light.
export function plate(shape: Point[], surface: Surface, options: PlateOptions = {}): BufferGeometry {
  const { lift = 0.01, edge = lift, rings = 7, center, uvScale } = options;
  // The face has to point out of the surface whichever way the outline was drawn.
  const area = shape.reduce((sum, p, i) => {
    const q = shape[(i + 1) % shape.length] as Point;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const outline = area < 0 ? [...shape].reverse() : shape;
  const count = outline.length;
  const [cx, cy] = center ?? [outline.reduce((sum, p) => sum + p[0], 0) / count, outline.reduce((sum, p) => sum + p[1], 0) / count];
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [su, sv] = uvScale ?? [1 / (maxX - minX), 1 / (maxY - minY)];
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const put = (x: number, y: number, z: number): void => {
    position.push(x, y, z);
    uv.push((x - minX) * su, (y - minY) * sv);
  };

  for (let k = 0; k <= rings; k++) {
    const s = 1 - k / (rings + 1);
    for (const [px, py] of outline) {
      const x = cx + (px - cx) * s;
      const y = cy + (py - cy) * s;
      put(x, y, surface(x, y) + lift);
    }
  }
  const middle = position.length / 3;
  put(cx, cy, surface(cx, cy) + lift);
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < count; j++) {
      const a = k * count + j;
      const b = k * count + ((j + 1) % count);
      const c = a + count;
      const d = b + count;
      index.push(a, b, c, b, d, c);
    }
  }
  for (let j = 0; j < count; j++) index.push(rings * count + j, rings * count + ((j + 1) % count), middle);

  // The wall has its own vertices, so the top edge stays crisp.
  const wall = position.length / 3;
  for (const [x, y] of outline) put(x, y, surface(x, y) + lift);
  for (const [x, y] of outline) put(x, y, surface(x, y) + lift - edge);
  for (let j = 0; j < count; j++) {
    const a = wall + j;
    const b = wall + ((j + 1) % count);
    index.push(a + count, b + count, a, b + count, b, a);
  }
  return finish(position, uv, index);
}

// Adds points along each side of a polygon, so a plate can follow a curve across its edges.
export function densify(points: Point[], per: number): Point[] {
  const out: Point[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as Point;
    for (let k = 0; k < per; k++) out.push([p[0] + ((q[0] - p[0]) * k) / per, p[1] + ((q[1] - p[1]) * k) / per]);
  });
  return out;
}

// A soft, repeatable pseudo-random bump for folds and dents.
export const wobble = (x: number, y: number): number =>
  Math.sin(x * 1.7 + Math.sin(y * 1.3) * 1.4) * 0.5 + Math.sin(y * 2.3 + Math.sin(x * 0.9) * 1.9) * 0.3 + Math.sin((x + y) * 3.1) * 0.2;
