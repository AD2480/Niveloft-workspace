import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { layerBands, sliceSpans, type BlockTask } from './snowpack';
import { BASE_TURN, blockProjector, cameraFrame, D, H, LABEL_GAP, PLINTH, SLICE_GAP, spreadLabels, stillModel, W } from './snowpackFrame';
import { SNOW_PALETTES } from './snowPalette';

/** The 3D scene's camera and block, built with three.js exactly as SnowpackScene builds them. */
function threeProjector(size: { w: number; h: number }, framing: { x: number; y: number }, zoom = 1, compact = false) {
  const camera = new THREE.PerspectiveCamera(26, size.w / size.h, 0.1, 120);
  camera.setViewOffset(size.w, size.h, framing.x * size.w, framing.y * size.h, size.w, size.h);
  const f = cameraFrame(camera.aspect, zoom, compact);
  camera.fov = f.fov;
  camera.position.set(...f.position);
  camera.lookAt(...f.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const block = new THREE.Group();
  block.position.y = PLINTH;
  block.rotation.y = BASE_TURN;
  block.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  return (x: number, y: number, z: number) => {
    v.set(x, y, z).applyMatrix4(block.matrixWorld).project(camera);
    return { x: ((v.x + 1) / 2) * size.w, y: ((1 - v.y) / 2) * size.h };
  };
}

const task = (key: string, layer: BlockTask['layer'], late = 0, holdsUp: string[] = []): BlockTask => ({ key, title: key, layer, late, holdsUp });
const TASKS: BlockTask[] = [
  task('T-1', 'done'),
  task('T-2', 'done'),
  task('T-3', 'review', 1),
  task('T-4', 'progress', 2, ['T-6', 'T-7']),
  task('T-5', 'progress'),
  task('T-6', 'todo'),
  task('T-7', 'todo'),
];

describe('the snowpack still', () => {
  it('projects the block exactly where the 3D scene draws it', () => {
    const cases = [
      { size: { w: 1440, h: 900 }, framing: { x: -0.2, y: -0.02 }, zoom: 1, compact: false },
      { size: { w: 390, h: 388 }, framing: { x: 0.07, y: -0.06 }, zoom: 1, compact: true },
      { size: { w: 760, h: 430 }, framing: { x: 0, y: -0.03 }, zoom: 1.22, compact: false },
    ];
    for (const c of cases) {
      const ours = blockProjector(c.size, c.framing, { zoom: c.zoom, compact: c.compact });
      const theirs = threeProjector(c.size, c.framing, c.zoom, c.compact);
      for (const [x, y, z] of [
        [-W / 2, 0, D / 2],
        [W / 2, 0, D / 2],
        [W / 2, 2.5, -D / 2],
        [-W / 2, 3.1, -D / 2],
        [0.4, 1.2, 0.3],
      ]) {
        const a = ours(x, y, z);
        const b = theirs(x, y, z);
        expect(a.x).toBeCloseTo(b.x, 2);
        expect(a.y).toBeCloseTo(b.y, 2);
        expect(a.depth).toBeGreaterThan(0);
      }
    }
  });

  it('puts the labels where the scene does: each layer’s right edge, and the weak slice', () => {
    const size = { w: 1200, h: 800 };
    const framing = { x: -0.1, y: 0 };
    const m = stillModel(TASKS, { weakKey: 'T-4', dark: false, size, framing });
    expect(m.anchors.map((a) => a.id)).toEqual(['done', 'review', 'progress', 'todo', 'weak']);
    const theirs = threeProjector(size, framing);
    const bands = layerBands({ done: 2, review: 1, progress: 2, todo: 2 }, H);
    bands.forEach((b, i) => {
      const ref = theirs(W / 2 + 0.02, (b.y0 + b.y1) / 2, D / 2 - 0.05);
      expect(m.anchors[i].x).toBeCloseTo(ref.x, 1);
      expect(m.anchors[i].y).toBeCloseTo(ref.y, 1);
    });
    // The weak task is the first of the two in progress, so its slice is the left one.
    const [x0, x1] = sliceSpans(2, W, SLICE_GAP)[0];
    const weak = theirs((x0 + x1) / 2, (bands[2].y0 + bands[2].y1) / 2, D / 2);
    expect(m.anchors[4].x).toBeCloseTo(weak.x, 1);
    expect(m.anchors[4].y).toBeCloseTo(weak.y, 1);
  });

  it('draws late slices in red, and only those', () => {
    const size = { w: 1000, h: 700 };
    const red = SNOW_PALETTES.light.weak;
    const count = (m: ReturnType<typeof stillModel>) => m.polygons.filter((p) => p.fill.toLowerCase() !== '#000000' && isReddish(p.fill, red)).length;
    expect(count(stillModel(TASKS, { weakKey: 'T-4', dark: false, size, framing: { x: 0, y: 0 } }))).toBe(1);
    expect(count(stillModel(TASKS, { weakKey: 'T-4', lateKeys: ['T-3', 'T-4'], dark: false, size, framing: { x: 0, y: 0 } }))).toBe(2);
    expect(count(stillModel(TASKS, { weakKey: null, dark: false, size, framing: { x: 0, y: 0 } }))).toBe(0);
  });

  it('shades the snow on top and keeps it in front-to-back order', () => {
    const m = stillModel(TASKS, { weakKey: null, dark: true, size: { w: 900, h: 600 }, framing: { x: 0, y: 0 } });
    expect(m.top.length).toBeGreaterThan(100);
    expect(new Set(m.top.map((p) => p.fill)).size).toBeGreaterThan(5);
    // One seam per gap between the two not-started slices, a stretch per row, among the patches.
    expect(m.topItems.filter((p) => p.stroke).length).toBeGreaterThan(0);
    expect(m.topItems.filter((p) => p.fill).length).toBe(m.top.length);
  });
});

/** Close to the weak layer's red (the still lightens it a little in the light theme). */
function isReddish(fill: string, red: string) {
  const c = (v: string) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  const [r, g, b] = c(fill);
  const [R, G, B] = c(red);
  return Math.abs(r - R) < 40 && Math.abs(g - G) < 40 && Math.abs(b - B) < 40 && r > g + 60;
}

describe('layer labels', () => {
  const at = (id: string, y: number) => ({ id, x: 10, y });
  const ys = (list: { id: string; y: number }[]) => Object.fromEntries(list.map((a) => [a.id, Math.round(a.y * 10) / 10]));

  it('leaves labels that already have room alone', () => {
    const anchors = [at('todo', 100), at('progress', 140), at('review', 180), at('done', 220), at('weak', 150)];
    expect(spreadLabels(anchors)).toEqual(anchors);
  });

  it('spreads a thin layer’s label and its neighbour evenly around where they were, in order', () => {
    const out = spreadLabels([at('todo', 100), at('progress', 170), at('review', 186), at('done', 260), at('weak', 175)]);
    expect(ys(out)).toEqual({ todo: 100, progress: 164.5, review: 191.5, done: 260, weak: 175 });
    expect(out.find((a) => a.id === 'review')!.y - out.find((a) => a.id === 'progress')!.y).toBe(LABEL_GAP);
  });

  it('keeps spreading when the group grows into the next label', () => {
    const out = spreadLabels([at('todo', 150), at('progress', 170), at('review', 180), at('done', 190)]);
    const y = out.map((a) => a.y);
    for (let i = 1; i < y.length; i++) expect(y[i] - y[i - 1]).toBeCloseTo(LABEL_GAP, 6);
    expect((y[0] + y[3]) / 2).toBeCloseTo((150 + 170 + 180 + 190) / 4, 6);
  });
});

