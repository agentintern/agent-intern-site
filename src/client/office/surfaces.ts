import {
  CanvasTexture, Color, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace,
  type Texture,
} from 'three';

// All of the surface detail is painted in code, so the site ships no image or model files for it.
type Paint = (ctx: CanvasRenderingContext2D, size: number) => void;

function painted(size: number, paint: Paint, color = false, repeat: [number, number] = [1, 1]): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  paint(ctx, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 8;
  return texture;
}

// A fixed sequence, so the poster and the live scene wear exactly the same scratches.
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Long, straight, faint strokes are what make steel read as brushed.
function brushStrokes(ctx: CanvasRenderingContext2D, size: number, angle: number, seed: number): void {
  const random = seeded(seed);
  ctx.fillStyle = '#8c8c8c';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle);
  for (let i = 0; i < 5200; i++) {
    const shade = random() > 0.5 ? 255 : 0;
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.02 + random() * 0.06})`;
    ctx.lineWidth = 0.6 + random() * 1.5;
    const y = (random() - 0.5) * size * 1.6;
    const x = (random() - 0.5) * size * 1.6;
    const length = size * (0.15 + random() * 0.6);
    ctx.beginPath();
    ctx.moveTo(x - length / 2, y);
    ctx.lineTo(x + length / 2, y + (random() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function scuffs(ctx: CanvasRenderingContext2D, size: number, count: number, seed: number): void {
  const random = seeded(seed);
  for (let i = 0; i < count; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + random() * 0.22})`;
    ctx.lineWidth = 0.7 + random() * 1.1;
    const x = random() * size;
    const y = random() * size;
    const a = random() * Math.PI;
    const length = 12 + random() * size * 0.09;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length);
    ctx.stroke();
  }
}

// The scratches the PFP has on its face: a few short ticks low on each side.
const faceTicks: [number, number, number, number][] = [
  [0.14, 0.72, 0.19, 0.67], [0.17, 0.76, 0.21, 0.71], [0.83, 0.72, 0.87, 0.77], [0.8, 0.76, 0.84, 0.81], [0.76, 0.81, 0.79, 0.84],
  [0.16, 0.19, 0.3, 0.17], [0.7, 0.2, 0.82, 0.22],
];

export interface Surfaces {
  steel: MeshStandardMaterial;
  face: MeshStandardMaterial;
  gunmetal: MeshStandardMaterial;
  joint: MeshStandardMaterial;
  rubber: MeshStandardMaterial;
  shirt: MeshPhysicalMaterial;
  shirtFolded: MeshPhysicalMaterial;
  tie: MeshPhysicalMaterial;
  trousers: MeshPhysicalMaterial;
  badge: MeshPhysicalMaterial;
  cord: MeshStandardMaterial;
  cabinet: MeshStandardMaterial;
  plastic: MeshStandardMaterial;
  paper: MeshStandardMaterial;
}

export function buildSurfaces(): Surfaces {
  const steelBrush = painted(1024, (c, s) => { brushStrokes(c, s, 0, 7); scuffs(c, s, 40, 11); }, false, [1.1, 1.1]);
  const faceBrush = painted(1024, (c, s) => {
    brushStrokes(c, s, -0.5, 23);
    scuffs(c, s, 26, 29);
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 2.4;
    for (const [x1, y1, x2, y2] of faceTicks) {
      c.beginPath();
      c.moveTo(x1 * s, y1 * s);
      c.lineTo(x2 * s, y2 * s);
      c.stroke();
    }
  });
  const dentMap = painted(1024, (c, s) => {
    brushStrokes(c, s, Math.PI / 2, 41);
    scuffs(c, s, 90, 43);
  });
  const weave = painted(256, (c, s) => {
    c.fillStyle = '#808080';
    c.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 3) {
      for (let x = 0; x < s; x += 3) {
        const v = ((x + y) / 3) % 2 ? 150 : 106;
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(x, y, 2, 2);
      }
    }
  }, false, [5, 5]);
  const silk = painted(256, (c, s) => {
    c.fillStyle = '#7a7a7a';
    c.fillRect(0, 0, s, s);
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 3;
    for (let i = -s; i < s * 2; i += 16) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i + s, s);
      c.stroke();
    }
  }, false, [5, 5]);

  const steelBase = new Color('#b4bdcc');
  const steel = new MeshStandardMaterial({
    color: steelBase, metalness: 1, roughness: 0.74, roughnessMap: steelBrush, bumpMap: steelBrush, bumpScale: 0.35,
  });
  const face = new MeshStandardMaterial({
    color: steelBase, metalness: 1, roughness: 0.66, roughnessMap: faceBrush, bumpMap: faceBrush, bumpScale: 0.5,
  });
  const gunmetal = new MeshStandardMaterial({ color: '#3d4656', metalness: 0.95, roughness: 0.55, roughnessMap: steelBrush, bumpMap: steelBrush, bumpScale: 0.2 });
  const joint = new MeshStandardMaterial({ color: '#171c29', metalness: 0.75, roughness: 0.42 });
  const rubber = new MeshStandardMaterial({ color: '#0d1019', metalness: 0.1, roughness: 0.78 });
  const shirt = new MeshPhysicalMaterial({
    color: '#e6e1d6', roughness: 0.86, metalness: 0,
    sheen: 0.35, sheenRoughness: 0.8, sheenColor: new Color('#fff4e2'),
  });
  const shirtFolded = shirt.clone();
  shirtFolded.vertexColors = true;
  const tie = new MeshPhysicalMaterial({
    color: '#b5261b', roughness: 0.56, metalness: 0, bumpMap: silk, bumpScale: 0.12,
    sheen: 0.4, sheenRoughness: 0.5, sheenColor: new Color('#ff6a4a'),
  });
  const trousers = new MeshPhysicalMaterial({
    color: '#222b42', roughness: 0.88, metalness: 0, bumpMap: weave, bumpScale: 0.03,
    sheen: 0.4, sheenRoughness: 0.8, sheenColor: new Color('#55648c'),
  });
  const badge = new MeshPhysicalMaterial({ color: '#efe6d4', roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const cord = new MeshStandardMaterial({ color: '#10131c', roughness: 0.7 });
  const cabinet = new MeshStandardMaterial({
    color: '#7c889c', metalness: 0.82, roughness: 0.8, roughnessMap: dentMap, bumpMap: dentMap, bumpScale: 0.6,
  });
  const plastic = new MeshStandardMaterial({ color: '#6d6a62', roughness: 0.58, metalness: 0.02, bumpMap: weave, bumpScale: 0.04 });
  const paper = new MeshStandardMaterial({ color: '#f5ebd8', roughness: 0.9 });
  return { steel, face, gunmetal, joint, rubber, shirt, shirtFolded, tie, trousers, badge, cord, cabinet, plastic, paper };
}

// The glow around the PFP, and the bloom around the eyes, without a post-processing pass.
export function softGlow(inner: string, outer: string): Texture {
  return painted(256, (c, s) => {
    const glow = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    glow.addColorStop(0, inner);
    glow.addColorStop(0.4, outer);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, s, s);
  }, true);
}
