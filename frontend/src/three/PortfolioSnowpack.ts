/**
 * Today's projects as small blocks of snowpack, one per project card: approved work at the base,
 * then in review, in progress, and fresh snow (not started) on top, each layer as thick as its
 * share of the tasks. Late work is taken out of its layers and laid down as one red layer just above
 * the approved base: the weak layer, buried under the newer snow. A block's height grows with the number of tasks, so a tall block is a big
 * project, not a good one.
 *
 * One transparent canvas lies over the whole grid of cards and every block is drawn at its card's
 * slot (measured from the page), with an orthographic camera, so every block is drawn the same
 * way wherever its card sits. It draws only when something changes: the settling on load (bottom
 * layer first, card by card), a block lifting under the pointer, a resize or a theme change.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { applyStudioEnvironment } from './sceneUtils';
import { BLOCK_ELEV, BLOCK_SIDE, BLOCK_TURN, blockBands, blockFrame, blockHeight, MOUND, PLINTH_H, PLINTH_PAD, SLOT_BASE, slotUnit, totalOf } from './portfolioBlocks';
import { waves, type LayerKey } from './snowpack';
import { clamp01, contactShadowTexture, damp, easeOutCubic, layerPieceGeometry, SNOW_PALETTES, striationTexture, type SnowPalette } from './snowpackKit';

export interface PortfolioBlock {
  id: number;
  counts: Record<LayerKey, number>;
  /** Open tasks past their due date, in each layer. */
  late: Partial<Record<LayerKey, number>>;
}

/** Where a block goes: its card's slot, in canvas pixels. */
export interface BlockSlot {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SIDE = BLOCK_SIDE;
const TURN = BLOCK_TURN;
const ELEV = BLOCK_ELEV;

interface Built {
  id: number;
  root: THREE.Group;
  /** The plinth and the layers (lifted on hover; the floor shadow stays). */
  body: THREE.Group;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  layers: THREE.Group[];
  mats: THREE.MeshStandardMaterial[];
  weakMats: THREE.MeshStandardMaterial[];
  height: number;
  order: number;
  lift: number;
}

export class PortfolioSnowpack {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private envDispose: () => void;
  private stria = striationTexture();
  private shadowTex = contactShadowTexture();
  private palette: SnowPalette;
  private dark: boolean;
  private blocks: Built[] = [];
  private data: PortfolioBlock[] = [];
  private slots: BlockSlot[] = [];
  private size = { w: 1, h: 1 };
  private hovered: number | null = null;
  private raf = 0;
  private last = 0;
  private intro = -1;
  private disposed = false;
  private readonly reduced: boolean;

  constructor(canvas: HTMLCanvasElement, opts: { dark: boolean; reducedMotion: boolean; lowPower: boolean }) {
    this.reduced = opts.reducedMotion;
    this.dark = opts.dark;
    this.palette = SNOW_PALETTES[opts.dark ? 'dark' : 'light'];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.setPixelRatio(opts.lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.hemi = new THREE.HemisphereLight();
    this.key = new THREE.DirectionalLight();
    this.key.position.set(-5, 9, 7);
    this.fill = new THREE.DirectionalLight();
    this.fill.position.set(7, 2.5, -1);
    this.scene.add(this.hemi, this.key, this.fill);
    this.envDispose = applyStudioEnvironment(this.renderer, this.scene, this.palette.env);
    this.applyLights();
  }

  setBlocks(blocks: PortfolioBlock[]) {
    this.data = blocks;
    this.build();
    this.place();
    // The settling plays once, the first time there is something to settle.
    if (this.intro < 0 && blocks.length && !this.reduced) this.intro = performance.now() / 1000 + 0.1;
    this.wake();
  }

  /** The cards' slots and the canvas size (CSS pixels). */
  layout(slots: BlockSlot[], width: number, height: number) {
    this.slots = slots;
    this.size = { w: Math.max(1, width), h: Math.max(1, height) };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.place();
    this.wake();
  }

  setHover(id: number | null) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.paint();
    this.wake();
  }

  setTheme(dark: boolean) {
    this.dark = dark;
    this.palette = SNOW_PALETTES[dark ? 'dark' : 'light'];
    this.scene.environmentIntensity = this.palette.env;
    this.applyLights();
    this.build();
    this.place();
    this.wake();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clear();
    this.stria.dispose();
    this.shadowTex.dispose();
    this.envDispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ building

  private applyLights() {
    const p = this.palette;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemi;
    this.key.color.set(p.key);
    this.key.intensity = p.keyI;
    this.fill.color.set(p.fill);
    this.fill.intensity = p.fillI;
  }

  private clear() {
    for (const b of this.blocks) {
      b.root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) mat.dispose();
      });
      this.scene.remove(b.root);
    }
    this.blocks = [];
  }

  private build() {
    this.clear();
    const p = this.palette;
    const biggest = Math.max(1, ...this.data.map((d) => totalOf(d.counts)));
    this.data.forEach((d, order) => {
      const total = totalOf(d.counts);
      const height = blockHeight(total, biggest);
      const root = new THREE.Group();
      const spin = new THREE.Group();
      spin.rotation.y = TURN;
      root.add(spin);

      // Floor shadow, then the plinth.
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry((SIDE + PLINTH_PAD) * 2.3, (SIDE + PLINTH_PAD) * 2.3),
        new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: p.shadow * 0.9 }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.001;
      shadow.renderOrder = -1;
      spin.add(shadow);
      const body = new THREE.Group();
      spin.add(body);
      const plinth = new THREE.Mesh(
        new RoundedBoxGeometry(SIDE + PLINTH_PAD, PLINTH_H, SIDE + PLINTH_PAD, 2, 0.03),
        new THREE.MeshStandardMaterial({ color: p.plinth, roughness: 0.62 }),
      );
      plinth.position.y = PLINTH_H / 2;
      body.add(plinth);

      const mats: THREE.MeshStandardMaterial[] = [];
      const weakMats: THREE.MeshStandardMaterial[] = [];
      const layers: THREE.Group[] = [];
      const half = SIDE / 2;
      if (total > 0) {
        const bands = blockBands(d.counts, d.late, height);
        const amp = 0.012;
        const seam = (i: number) => (x: number, z: number) => bands[i].y1 + amp * waves(x * 2.6 + i * 3.1 + order, z * 2.6 + i * 1.7, i + 1);
        // The top: a soft mound of fresh snow towards the back, settling down to the cut edges.
        const cap = (x: number, z: number) => {
          const top = bands[bands.length - 1].y1;
          const hill = MOUND * Math.exp(-((x + 0.1) ** 2 / 0.2 + (z + 0.08) ** 2 / 0.15));
          const drift = 0.012 * waves(x * 4 + order * 2, z * 4, 7);
          const edge = Math.min(1, (half - Math.abs(x)) / 0.14, (half - Math.abs(z)) / 0.14);
          return top + Math.max(0, hill + drift + 0.012) * Math.max(0, edge);
        };
        bands.forEach((band, i) => {
          const g = new THREE.Group();
          g.userData.y0 = band.y0;
          const bottom = i === 0 ? () => 0 : seam(i - 1);
          const top = i === bands.length - 1 ? cap : seam(i);
          const isTop = i === bands.length - 1;
          const weak = band.key === 'weak';
          const geo = layerPieceGeometry(-half, half, -half, half, bottom, top, 9);
          const color = weak ? p.weak : p.face[band.key as LayerKey];
          const topColor = weak ? p.weak : isTop ? p.snow : new THREE.Color(color).lerp(new THREE.Color('#ffffff'), this.dark ? 0.08 : 0.28).getStyle();
          const topMat = new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.9 });
          const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, map: this.stria });
          if (weak) {
            for (const m of [topMat, wallMat]) {
              m.emissive.set(p.weakGlow);
              m.emissiveIntensity = 0.12;
              weakMats.push(m);
            }
          } else mats.push(topMat, wallMat);
          g.add(new THREE.Mesh(geo, [topMat, wallMat]));
          g.position.y = PLINTH_H;
          layers.push(g);
          body.add(g);
        });
      } else {
        // No tasks yet: a thin sheet of snow on the plinth.
        const sheet = new THREE.Mesh(new RoundedBoxGeometry(SIDE, height, SIDE, 2, 0.02), new THREE.MeshStandardMaterial({ color: p.face.todo, roughness: 0.9 }));
        sheet.position.y = PLINTH_H + height / 2;
        body.add(sheet);
      }
      this.scene.add(root);
      this.blocks.push({ id: d.id, root, body, shadow, layers, mats, weakMats, height: height + MOUND, order, lift: 0 });
    });
    this.paint();
  }

  /** Hover: the block under the pointer is lit a little. */
  private paint() {
    for (const b of this.blocks) {
      const on = b.id === this.hovered;
      for (const m of b.mats) {
        m.emissive.copy(m.color);
        m.emissiveIntensity = on ? 0.14 : 0;
      }
      for (const m of b.weakMats) m.emissiveIntensity = on ? 0.26 : 0.12;
    }
  }

  /**
   * Puts each block in its slot. With 1 world unit = `unit` pixels, a point on the floor at (X, 0, Z)
   * appears X·unit right of the canvas centre and Z·sin(ELEV)·unit below it.
   */
  private place() {
    const { w, h } = this.size;
    const ready = this.slots.filter((s) => this.blocks.some((b) => b.id === s.id));
    const { below } = blockFrame();
    const unit = ready.length ? Math.min(...ready.map((s) => slotUnit(s.w, s.h))) : 100;
    this.camera.left = -w / 2 / unit;
    this.camera.right = w / 2 / unit;
    this.camera.top = h / 2 / unit;
    this.camera.bottom = -h / 2 / unit;
    const dist = 120;
    this.camera.position.set(0, Math.sin(ELEV) * dist, Math.cos(ELEV) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    for (const b of this.blocks) {
      const s = ready.find((r) => r.id === b.id);
      b.root.visible = !!s;
      if (!s) continue;
      // The block's lowest point on screen is the plinth's front corner; stand it on the slot's base line.
      const baseY = s.y + s.h * SLOT_BASE - below * unit;
      const X = (s.x + s.w / 2 - w / 2) / unit;
      const Z = (baseY - h / 2) / unit / Math.sin(ELEV);
      b.root.position.set(X, 0, Z);
    }
  }

  // ------------------------------------------------------------------ frame

  private wake() {
    if (this.disposed || this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = () => {
    this.raf = 0;
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    const t = now / 1000;
    for (const b of this.blocks) {
      // The settling: snow accumulates, each layer growing up from the one below, card after card.
      const since = this.intro < 0 ? 10 : t - this.intro - b.order * 0.1;
      b.layers.forEach((g, i) => {
        const k = this.reduced ? 1 : easeOutCubic(clamp01((since - i * 0.16) / 0.5));
        if (k < 1) moving = true;
        g.visible = k > 0.001;
        g.scale.y = Math.max(0.001, k);
        g.position.y = PLINTH_H + (g.userData.y0 as number) * (1 - k);
      });
      const want = b.id === this.hovered ? 0.07 : 0;
      b.lift = this.reduced ? want : damp(b.lift, want, 14, dt);
      if (Math.abs(b.lift - want) > 1e-4) moving = true;
      b.body.position.y = b.lift;
      b.shadow.material.opacity = this.palette.shadow * (0.9 - b.lift * 3);
    }
    this.renderer.render(this.scene, this.camera);
    if (moving) this.raf = requestAnimationFrame(this.loop);
  };
}
