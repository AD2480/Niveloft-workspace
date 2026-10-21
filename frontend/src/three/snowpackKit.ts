/**
 * What every snowpack drawing shares: the palettes (light and dark), the striated texture of a cut
 * snow wall, the soft contact shadow, and the geometry of a layer whose top and bottom follow a
 * surface. Used by the front page's block (SnowpackScene), the project Overview's block (the same
 * scene with the project's tasks) and Today's row of project blocks (PortfolioSnowpack).
 */
import * as THREE from 'three';

export { SNOW_PALETTES, type SnowPalette } from './snowPalette';

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Frame-rate independent easing towards a target. */
export const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/** A seeded random generator, so the textures are the same on every load. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** A striated texture for the cut faces: fine horizontal lines and grain, like the wall of a snow pit. */
export function striationTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  const rnd = seeded(3);
  for (let i = 0; i < 14; i++) {
    const y = rnd() * 256;
    g.fillStyle = `rgba(0,0,0,${0.012 + rnd() * 0.028})`;
    g.fillRect(0, y, 256, 0.8 + rnd() * 2.4);
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${0.18 + rnd() * 0.3})` : `rgba(0,0,0,${0.015 + rnd() * 0.03})`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd(), 1 + rnd());
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A soft round shadow to lay on the floor under a block. */
export function contactShadowTexture(): THREE.CanvasTexture {
  const blob = document.createElement('canvas');
  blob.width = blob.height = 128;
  const g = blob.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(blob);
}

type Surface = (x: number, z: number) => number;

/**
 * One piece of a layer over the rectangle [x0, x1] × [z0, z1]: its top surface (a grid following
 * `top`) and its four cut walls down to `bottom`. Two groups: 0 = top, 1 = walls. The walls get
 * their own vertices, so the edges stay crisp.
 */
export function layerPieceGeometry(x0: number, x1: number, z0: number, z1: number, bottom: Surface, top: Surface, density: number): THREE.BufferGeometry {
  const nx = Math.max(2, Math.ceil((x1 - x0) * density));
  const nz = Math.max(2, Math.ceil((z1 - z0) * density));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      pos.push(x, top(x, z), z);
      uv.push(x * 0.35, z * 0.35);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + (nx + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const topCount = idx.length;
  // Walls: each is a strip of quads along an edge, from the bottom surface to the top surface.
  const wall = (pts: [number, number][]) => {
    const base = pos.length / 3;
    let along = 0;
    pts.forEach(([x, z], k) => {
      if (k > 0) along += Math.hypot(x - pts[k - 1][0], z - pts[k - 1][1]);
      const yb = bottom(x, z);
      const yt = top(x, z);
      pos.push(x, yb, z, x, yt, z);
      uv.push(along * 0.5, yb * 1.6, along * 0.5, yt * 1.6);
    });
    for (let k = 0; k < pts.length - 1; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };
  const line = (from: [number, number], to: [number, number], n: number): [number, number][] =>
    Array.from({ length: n + 1 }, (_, k) => [from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n] as [number, number]);
  wall(line([x0, z1], [x1, z1], nx)); // front
  wall(line([x1, z0], [x0, z0], nx)); // back
  wall(line([x0, z0], [x0, z1], nz)); // left
  wall(line([x1, z1], [x1, z0], nz)); // right
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, topCount, 0);
  g.addGroup(topCount, idx.length - topCount, 1);
  g.computeVertexNormals();
  return g;
}
