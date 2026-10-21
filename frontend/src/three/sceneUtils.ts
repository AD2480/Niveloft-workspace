/**
 * Small helpers shared by the 3D views: theme colours from CSS variables, text labels,
 * capability checks and disposal. Everything 3D lives under src/three and is loaded lazily,
 * so three.js never lands in the main bundle.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export { onThemeChange, prefersReducedMotion, webglAvailable } from './capabilities';

/** Colours for 3D, read from the same CSS variables as the rest of the UI (light and dark). */
export interface SceneTheme {
  dark: boolean;
  canvas: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentDisplay: string;
  danger: string;
  todo: string;
  progress: string;
  review: string;
  done: string;
  ground: string;
}

export function readTheme(el: HTMLElement = document.documentElement): SceneTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = el.classList.contains('dark');
  return {
    dark,
    canvas: v('--canvas', dark ? '#0e1419' : '#f4f6f7'),
    surface: v('--surface', dark ? '#16191e' : '#ffffff'),
    surface2: v('--surface-2', dark ? '#1c2026' : '#f8f9fb'),
    ink: v('--ink', dark ? '#eef3f6' : '#17212b'),
    ink2: v('--ink-2', dark ? '#cfd5de' : '#333941'),
    muted: v('--muted', '#5a616b'),
    line: v('--line', dark ? '#2a2f37' : '#e3e6eb'),
    lineStrong: v('--line-strong', dark ? '#3f4550' : '#c9ced6'),
    accent: v('--accent', dark ? '#8cc4e0' : '#245b78'),
    accentDisplay: v('--accent-display', dark ? '#8cc4e0' : '#245b78'),
    danger: v('--danger', dark ? '#ef8a76' : '#b23a2a'),
    todo: v('--model-todo', dark ? '#373c45' : '#d5dae1'),
    progress: v('--model-progress', dark ? '#d5dae2' : '#3d4553'),
    review: v('--model-review', dark ? '#e39a3b' : '#c98a2e'),
    done: v('--model-done', dark ? '#b8925f' : '#8a6a46'),
    ground: v('--model-ground', dark ? '#14171b' : '#f9fafb'),
  };
}

export interface LabelOptions {
  color: string;
  /** Height of the label in world units. */
  size?: number;
  weight?: number;
  uppercase?: boolean;
  /** Letter spacing in em. */
  tracking?: number;
  background?: string;
  align?: 'left' | 'center';
  opacity?: number;
}

const FONT_STACK = '"Geist Variable", Geist, ui-sans-serif, system-ui, sans-serif';

/** A camera-facing text label rendered to a canvas texture. */
export function makeLabel(text: string, opts: LabelOptions): THREE.Sprite {
  const size = opts.size ?? 0.32;
  const px = 64; // texture font size; the sprite is scaled to `size`
  // Sentence case unless asked otherwise: easier to read at a distance than tracked capitals.
  const label = opts.uppercase === true ? text.toUpperCase() : text;
  const tracking = opts.tracking ?? (opts.uppercase === true ? 0.16 : 0);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();
  const font = `${opts.weight ?? 600} ${px}px ${FONT_STACK}`;
  ctx.font = font;
  // Manual tracking so it works in every browser.
  const chars = [...label];
  const spacing = tracking * px;
  const widths = chars.map((c) => ctx.measureText(c).width);
  const textWidth = widths.reduce((a, w) => a + w, 0) + spacing * Math.max(0, chars.length - 1);
  const padX = opts.background ? px * 0.45 : px * 0.1;
  const padY = opts.background ? px * 0.3 : px * 0.15;
  canvas.width = Math.ceil(textWidth + padX * 2);
  canvas.height = Math.ceil(px * 1.2 + padY * 2);
  const c = canvas.getContext('2d')!;
  if (opts.background) {
    c.fillStyle = opts.background;
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  c.font = font;
  c.fillStyle = opts.color;
  c.textBaseline = 'middle';
  let x = padX;
  chars.forEach((ch, i) => {
    c.fillText(ch, x, canvas.height / 2);
    x += widths[i] + spacing;
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: opts.opacity ?? 1 });
  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(size * aspect * (canvas.height / (px * 1.2)), size * (canvas.height / (px * 1.2)), 1);
  if (opts.align === 'left') sprite.center.set(0, 0.5);
  sprite.renderOrder = 10;
  return sprite;
}

/** Frees GPU resources held by an object tree. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const withGeometry = obj as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    withGeometry.geometry?.dispose();
    const materials = Array.isArray(withGeometry.material) ? withGeometry.material : withGeometry.material ? [withGeometry.material] : [];
    for (const m of materials) {
      const mapped = m as THREE.Material & { map?: THREE.Texture | null };
      mapped.map?.dispose();
      m.dispose();
    }
  });
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * A soft studio environment so bronze reads as metal (metals are black without something to
 * reflect). Returns a disposer.
 */
export function applyStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, intensity = 0.55): () => void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = pmrem.fromScene(room, 0.04);
  scene.environment = target.texture;
  scene.environmentIntensity = intensity;
  room.dispose();
  pmrem.dispose();
  return () => target.dispose();
}

/** Smallest distance along `direction` from `target` at which every corner of `box` is on screen. */
export function fitCameraDistance(camera: THREE.PerspectiveCamera, box: THREE.Box3, target: THREE.Vector3, direction: THREE.Vector3, marginX = 0.94, marginY = 0.9): number {
  const probe = camera.clone();
  probe.far = 1e6; // the search must be monotonic: ignore the far plane while probing
  const dir = direction.clone().normalize();
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const p = new THREE.Vector3();
  const fits = (dist: number) => {
    probe.position.copy(target).addScaledVector(dir, dist);
    probe.up.set(0, 1, 0);
    probe.lookAt(target);
    probe.updateMatrixWorld(true);
    probe.updateProjectionMatrix();
    return corners.every((c) => {
      p.copy(c).project(probe);
      return p.z < 1 && Math.abs(p.x) <= marginX && Math.abs(p.y) <= marginY;
    });
  };
  let lo = 0.5;
  let hi = 2000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Like {@link fitCameraDistance}, but also re-centres the target so the box's projection sits in
 * the middle of the frame. An oblique view of a flat table projects asymmetrically around its
 * centre, so fitting around the centre alone leaves empty space on one side.
 */
export function fitCameraView(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  target: THREE.Vector3,
  direction: THREE.Vector3,
  marginX = 0.94,
  marginY = 0.9,
): { target: THREE.Vector3; distance: number } {
  const dir = direction.clone().normalize();
  const t = target.clone();
  let distance = fitCameraDistance(camera, box, t, dir, marginX, marginY);
  const probe = camera.clone();
  probe.far = 1e6;
  const p = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    probe.position.copy(t).addScaledVector(dir, distance);
    probe.up.set(0, 1, 0);
    probe.lookAt(t);
    probe.updateMatrixWorld(true);
    probe.updateProjectionMatrix();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          p.set(x, y, z).project(probe);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    if (Math.abs(cx) < 0.01 && Math.abs(cy) < 0.01) break;
    // Pan the target by the off-centre amount, measured at the target's distance.
    const halfH = Math.tan(THREE.MathUtils.degToRad(probe.fov) / 2) * distance;
    const halfW = halfH * probe.aspect;
    right.setFromMatrixColumn(probe.matrixWorld, 0);
    up.setFromMatrixColumn(probe.matrixWorld, 1);
    t.addScaledVector(right, cx * halfW).addScaledVector(up, cy * halfH);
    distance = fitCameraDistance(camera, box, t, dir, marginX, marginY);
  }
  return { target: t, distance };
}
