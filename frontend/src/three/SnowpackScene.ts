/**
 * The front page's centrepiece: the sample project as a cut-away block of snowpack on a plinth,
 * lit like a product shot. One layer per state (approved at the base, then in review, in progress,
 * and fresh snow on top), one slice per task, and the weak layer (the late task holding the most
 * work up) in red. Snow falls around it. On load the layers drop in and settle, bottom first; as the
 * page scrolls they lift apart so each can be read, then close again.
 *
 * Everything shown comes from the sample's records (layers.ts / snowpack.ts); the block's shape,
 * the waves between layers and the hill of fresh snow on top are decoration.
 *
 * Performance: a few thousand triangles, one shadow map, snow animated on the GPU. On slow hardware
 * (`lowPower`) there are no shadows and less snow, and it draws only when something changes; with
 * reduced motion it never animates on its own.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { applyStudioEnvironment } from './sceneUtils';
import { clamp01, contactShadowTexture, damp, easeOutCubic, layerPieceGeometry, SNOW_PALETTES, striationTexture, type SnowPalette } from './snowpackKit';
import { LAYER_ORDER, layerBands, sliceSpans, storyAt, type BlockTask, type LayerBand, type LayerKey, type StoryFocus } from './snowpack';
import { BASE_TURN, cameraFrame, D, H, interfaceY, LIFT, PLINTH, SLICE_GAP, sliceOrder, topY, W } from './snowpackFrame';

export interface SnowpackAnchor {
  id: LayerKey | 'weak';
  /** Canvas pixels. */
  x: number;
  y: number;
}

export interface SnowpackOptions {
  tasks: BlockTask[];
  weakKey: string | null;
  /** Other late tasks, drawn red too (the weak one is the one holding the most work up). */
  lateKeys?: string[];
  /** Snow falling, a slow idle sway and the weak layer breathing. Off in the workspace: it draws only when something changes. */
  ambient?: boolean;
  /** Closer (above 1) or further (below 1) than the default framing. */
  zoom?: number;
  /** The layers drop in and settle on load. Off where a still of the settled block is already showing, so it fades into the scene without a jump. */
  intro?: boolean;
  dark: boolean;
  compact: boolean;
  lowPower: boolean;
  reducedMotion: boolean;
  /** Where the block sits in the frame: -0.5 … 0.5 of the width (negative moves it right), and of the height (negative moves it down). */
  framing?: { x: number; y: number };
  onAnchors?: (anchors: SnowpackAnchor[]) => void;
  onHover?: (task: BlockTask | null, at: { x: number; y: number } | null) => void;
}

interface Slice {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]>;
  task: BlockTask;
  layer: number;
  index: number;
  count: number;
  cx: number;
  weak: boolean;
  late: boolean;
}

const FLAKE_VERT = `
  uniform float uTime;
  uniform float uHeight;
  uniform float uSize;
  uniform float uSettle;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aScale;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float fall = mod(p.y - uTime * aSpeed, uHeight);
    p.y = fall - 1.2;
    p.x += sin(uTime * 0.45 + aPhase) * 0.35;
    p.z += cos(uTime * 0.37 + aPhase * 1.3) * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aScale * (12.0 / -mv.z);
    // Fade in at the top, out at the bottom; thinner while the layers are still settling in.
    vAlpha = smoothstep(0.0, 1.2, fall) * smoothstep(uHeight, uHeight - 1.5, fall) * (0.55 + 0.45 * uSettle);
  }
`;
const FLAKE_FRAG = `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * a * uAlpha * vAlpha);
  }
`;

export class SnowpackScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.1, 120);
  private block = new THREE.Group();
  private layers: THREE.Group[] = [];
  private slices: Slice[] = [];
  private bands: LayerBand[];
  private plinth!: THREE.Mesh;
  private shadow!: THREE.Mesh;
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private fill!: THREE.DirectionalLight;
  private flakes: THREE.Points | null = null;
  private flakeMat: THREE.ShaderMaterial | null = null;
  private envDispose: (() => void) | null = null;
  private stria: THREE.CanvasTexture;
  private palette: SnowPalette;
  private opts: SnowpackOptions;
  private raycaster = new THREE.Raycaster();
  private size = { w: 1, h: 1 };
  private raf = 0;
  private running = false;
  private last = 0;
  private t = 0;
  /** Wall-clock seconds since start(): the settling takes the same time on slow hardware. */
  private wall = 0;
  private wall0 = 0;
  private introStart = 0;
  private dirty = true;
  private story = { explode: 0, focus: null as StoryFocus, turn: 0 };
  private shown = { explode: 0, turn: 0, focus: new Map<number, number>() };
  private drag = { yaw: 0, target: 0 };
  private hovered: Slice | null = null;
  private visible = true;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: SnowpackOptions) {
    this.opts = opts;
    this.palette = SNOW_PALETTES[opts.dark ? 'dark' : 'light'];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowPower, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = !opts.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(opts.lowPower ? 1 : Math.min(window.devicePixelRatio || 1, opts.compact ? 2 : 1.75));
    this.stria = striationTexture();

    const counts = { done: 0, review: 0, progress: 0, todo: 0 } as Record<LayerKey, number>;
    for (const t of opts.tasks) counts[t.layer]++;
    this.bands = layerBands(counts, H);
    this.build();
    this.scene.add(this.block);
    this.block.position.y = PLINTH;
    this.envDispose = applyStudioEnvironment(this.renderer, this.scene, this.palette.env);
    this.applyPalette();
    if (opts.reducedMotion || opts.intro === false) this.introStart = -10;
  }

  // ------------------------------------------------------------------ building

  private build() {
    const p = this.palette;
    // The plinth: a slab of stone the block stands on, a little larger than it.
    const plinthGeo = new RoundedBoxGeometry(W + 0.42, PLINTH, D + 0.42, 3, 0.05);
    this.plinth = new THREE.Mesh(plinthGeo, new THREE.MeshStandardMaterial({ color: p.plinth, roughness: 0.62, metalness: 0 }));
    this.plinth.position.y = PLINTH / 2;
    this.plinth.receiveShadow = true;
    this.plinth.castShadow = true;
    this.scene.add(this.plinth);

    // A soft contact shadow on the floor (and the real one, where shadows are on).
    const blobTex = contactShadowTexture();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, D * 2.2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: p.shadow }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);

    // Lights: a studio key from the upper left, a cold fill from the right, sky and snow-bounce.
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemi);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(p.key, p.keyI);
    this.key.position.set(-6, 10, 7);
    this.key.castShadow = !this.opts.lowPower;
    this.key.shadow.mapSize.set(this.opts.compact ? 1024 : 2048, this.opts.compact ? 1024 : 2048);
    const sc = this.key.shadow.camera;
    sc.left = -7;
    sc.right = 7;
    sc.top = 7;
    sc.bottom = -7;
    sc.near = 1;
    sc.far = 30;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(p.fill, p.fillI);
    this.fill.position.set(8, 3, -2);
    this.scene.add(this.fill);

    // The layers, bottom to top, one slice per task.
    const byLayer = new Map<LayerKey, BlockTask[]>();
    for (const t of this.opts.tasks) byLayer.set(t.layer, [...(byLayer.get(t.layer) ?? []), t]);
    this.bands.forEach((band, i) => {
      const group = new THREE.Group();
      group.userData.layer = i;
      const tasks = sliceOrder(byLayer.get(band.key) ?? []);
      const spans = sliceSpans(tasks.length, W, SLICE_GAP);
      const bottom = (x: number, z: number) => (i === 0 ? 0 : interfaceY(this.bands[i - 1], i - 1, x, z));
      const top = (x: number, z: number) => (i === this.bands.length - 1 ? topY(band, x, z) : interfaceY(band, i, x, z));
      const density = this.opts.compact || this.opts.lowPower ? 5 : 8;
      tasks.forEach((task, k) => {
        const [x0, x1] = spans[k];
        const geo = layerPieceGeometry(x0, x1, -D / 2, D / 2, bottom, top, density);
        const weak = task.key === this.opts.weakKey;
        const late = weak || (this.opts.lateKeys?.includes(task.key) ?? false);
        const mats = [new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }), new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, map: this.stria })];
        const mesh = new THREE.Mesh(geo, mats);
        mesh.castShadow = !this.opts.lowPower;
        mesh.receiveShadow = !this.opts.lowPower;
        mesh.userData.slice = true;
        const cx = (x0 + x1) / 2;
        // Each slice is drawn around its own centre so it can spread a little when the layers lift.
        geo.translate(-cx, 0, 0);
        mesh.position.x = cx;
        group.add(mesh);
        this.slices.push({ mesh, task, layer: i, index: k, count: tasks.length, cx, weak, late });
      });
      this.layers.push(group);
      this.block.add(group);
    });

    // Snow falling around the block (on the GPU).
    if (this.opts.ambient === false) return;
    const count = this.opts.lowPower ? 220 : this.opts.compact ? 380 : 900;
    const positions = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const scale = new Float32Array(count);
    let seed = 11;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < count; i++) {
      const r = 2.5 + rnd() * 9;
      const a = rnd() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = rnd() * 10;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.8 - 1;
      speed[i] = 0.35 + rnd() * 0.55;
      phase[i] = rnd() * 6.283;
      scale[i] = 0.5 + rnd() * rnd() * 1.6;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    fg.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    fg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    fg.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    this.flakeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: 10 },
        uSize: { value: this.opts.compact ? 5.5 : 7 },
        uSettle: { value: 0 },
        uColor: { value: new THREE.Color(p.flake) },
        uAlpha: { value: p.flakeA },
      },
      vertexShader: FLAKE_VERT,
      fragmentShader: FLAKE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.flakes = new THREE.Points(fg, this.flakeMat);
    this.flakes.frustumCulled = false;
    this.scene.add(this.flakes);
  }

  private faceColor(i: number): string {
    return this.palette.face[this.bands[i].key];
  }

  /** Colours for the current theme and focus. */
  private applyPalette() {
    const p = this.palette;
    (this.plinth.material as THREE.MeshStandardMaterial).color.set(p.plinth);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = p.shadow;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemi;
    this.key.color.set(p.key);
    this.key.intensity = p.keyI;
    this.fill.color.set(p.fill);
    this.fill.intensity = p.fillI;
    if (this.flakeMat) {
      (this.flakeMat.uniforms.uColor.value as THREE.Color).set(p.flake);
      this.flakeMat.uniforms.uAlpha.value = p.flakeA;
    }
    this.scene.environmentIntensity = p.env;
    this.paintSlices();
    this.dirty = true;
  }

  private tmpA = new THREE.Color();
  private tmpB = new THREE.Color();

  /** Each slice's colour: its layer's, dimmed when another layer is being read, lit when hovered. */
  private paintSlices() {
    const p = this.palette;
    const top = this.bands.length - 1;
    for (const s of this.slices) {
      // Late slices stay lit while the weak layer is being read.
      const focusAmt = s.late && this.story.focus === 'weak' ? 1 : (this.shown.focus.get(s.layer) ?? 1);
      const base = s.late ? p.weak : this.faceColor(s.layer);
      const [topMat, wallMat] = s.mesh.material;
      // Walls: the layer's colour (dimmed towards the plinth's when not in focus).
      this.tmpA.set(base);
      this.tmpB.set(p.dim);
      wallMat.color.copy(this.tmpA).lerp(this.tmpB, (1 - focusAmt) * 0.55);
      // Tops: the top layer is fresh snow; inner layers show a lighter version of their colour.
      if (s.layer === top && !s.late) this.tmpA.set(p.snow);
      else this.tmpA.set(base).lerp(this.tmpB.set('#ffffff'), this.opts.dark ? 0.08 : 0.28);
      topMat.color.copy(this.tmpA).lerp(this.tmpB.set(p.dim), (1 - focusAmt) * 0.45);
      const hover = this.hovered === s ? 1 : 0;
      const glow = s.weak ? 0.22 + 0.25 * (this.story.focus === 'weak' ? 1 : 0) : s.late ? 0.08 : 0;
      for (const m of s.mesh.material) {
        m.emissive.set(s.late ? p.weakGlow : base);
        m.emissiveIntensity = glow + hover * 0.22;
      }
    }
  }

  // ------------------------------------------------------------------ public API

  setTheme(dark: boolean) {
    this.palette = SNOW_PALETTES[dark ? 'dark' : 'light'];
    this.opts.dark = dark;
    this.applyPalette();
  }

  /** The scroll story (see storyAt). */
  setStory(s: number) {
    const st = storyAt(s);
    if (st.explode === this.story.explode && st.focus === this.story.focus && st.turn === this.story.turn) return;
    this.story = { explode: st.explode, focus: st.focus, turn: st.turn };
    this.dirty = true;
    this.wake();
  }

  setFraming(framing: { x: number; y: number }) {
    this.opts.framing = framing;
    this.resize(this.size.w, this.size.h);
  }

  resize(w: number, h: number) {
    this.size = { w: Math.max(1, w), h: Math.max(1, h) };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.camera.aspect = this.size.w / this.size.h;
    const f = this.opts.framing ?? { x: 0, y: 0 };
    // Shift the picture without moving the camera, so the perspective stays a product shot's.
    this.camera.setViewOffset(this.size.w, this.size.h, f.x * this.size.w, f.y * this.size.h, this.size.w, this.size.h);
    this.frameCamera();
    this.dirty = true;
    this.wake();
  }

  /** Drag to turn the block a little (radians, relative). */
  turnBy(d: number) {
    this.drag.target = Math.max(-0.9, Math.min(0.9, this.drag.target + d));
    this.wake();
  }

  /** The task under a point (canvas pixels), for hover and click. */
  pick(x: number, y: number): BlockTask | null {
    const s = this.pickSlice(x, y);
    if (s !== this.hovered) {
      this.hovered = s;
      this.paintSlices();
      this.dirty = true;
      this.wake();
    }
    return s?.task ?? null;
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v) this.wake();
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.wall0 = this.last / 1000;
    if (!this.opts.reducedMotion && this.opts.intro !== false) this.introStart = 0.15;
    this.loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.stria.dispose();
    this.envDispose?.();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ frame

  private frameCamera() {
    // A three-quarter view from a little above, at a distance that fits the block with the lifted
    // layers (the same frame the still drawing is projected with).
    const f = cameraFrame(this.camera.aspect, this.opts.zoom ?? 1, this.opts.compact);
    this.camera.fov = f.fov;
    this.camera.position.set(...f.position);
    this.camera.lookAt(...f.target);
    this.camera.updateProjectionMatrix();
  }

  private wake() {
    if (!this.running || this.disposed) return;
    if (this.raf === 0) this.loop();
  }

  private loop = () => {
    this.raf = 0;
    if (this.disposed) return;
    const now = performance.now();
    const raw = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(0.05, raw);
    this.t += dt;
    this.wall = performance.now() / 1000 - this.wall0;
    const animating = this.step(Math.min(0.12, raw));
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.emitAnchors();
      this.dirty = false;
    }
    // Keep going while something moves (snow, the settling, a story change easing in); otherwise wait.
    const continuous = this.opts.ambient !== false && !this.opts.lowPower && !this.opts.reducedMotion && this.visible && !document.hidden;
    if (continuous || animating) this.raf = requestAnimationFrame(this.loop);
  };

  /** Advances everything by dt; returns whether anything is still moving towards a target. */
  private step(dt: number): boolean {
    let moving = false;
    const reduce = this.opts.reducedMotion;
    // The story eases in (or jumps, with reduced motion).
    const k = reduce ? 1e6 : 5;
    const ex = damp(this.shown.explode, this.story.explode, k, dt);
    const tu = damp(this.shown.turn, this.story.turn, k, dt);
    if (Math.abs(ex - this.story.explode) > 1e-4 || Math.abs(tu - this.story.turn) > 1e-4) moving = true;
    this.shown.explode = ex;
    this.shown.turn = tu;
    let focusChanged = false;
    this.bands.forEach((band, i) => {
      const want = this.story.focus === null ? 1 : this.story.focus === 'weak' ? 0 : this.story.focus === band.key ? 1 : 0;
      const cur = this.shown.focus.get(i) ?? 1;
      const next = damp(cur, want, reduce ? 1e6 : 6, dt);
      if (Math.abs(next - want) > 1e-3) moving = true;
      if (Math.abs(next - cur) > 1e-4) focusChanged = true;
      this.shown.focus.set(i, next);
    });
    if (focusChanged) this.paintSlices();
    this.drag.yaw = damp(this.drag.yaw, this.drag.target, reduce ? 1e6 : 6, dt);
    if (Math.abs(this.drag.yaw - this.drag.target) > 1e-4) moving = true;

    // The settling: each layer drops in from above, bottom first.
    const since = this.wall - this.introStart;
    let settle = 1;
    this.layers.forEach((group, i) => {
      const p = reduce ? 1 : clamp01((since - i * 0.2) / 0.95);
      settle = Math.min(settle, p);
      const fall = (1 - easeOutCubic(p)) * 3.2;
      group.visible = p > 0;
      group.position.y = fall + this.shown.explode * i * LIFT;
      group.scale.y = 1 + (1 - p) * 0.08;
    });
    if (settle < 1) moving = true;
    // Slices spread a little when the layers lift.
    for (const s of this.slices) s.mesh.position.x = s.cx + this.shown.explode * (s.index - (s.count - 1) / 2) * 0.05;

    // A slow turn: an idle sway, the story's turn and the visitor's drag.
    const idle = reduce || this.opts.lowPower || this.opts.ambient === false ? 0 : Math.sin(this.t * 0.11) * 0.1;
    this.block.rotation.y = BASE_TURN + idle + this.shown.turn + this.drag.yaw;
    this.plinth.rotation.y = this.block.rotation.y;
    this.shadow.rotation.z = this.block.rotation.y;
    if (this.flakeMat) {
      this.flakeMat.uniforms.uTime.value = reduce ? 3.7 : this.t;
      this.flakeMat.uniforms.uSettle.value = settle;
    }
    // The weak layer breathes, gently.
    if (!reduce && !this.opts.lowPower && this.opts.ambient !== false) {
      for (const s of this.slices) {
        if (!s.weak) continue;
        const base = 0.22 + 0.25 * (this.story.focus === 'weak' ? 1 : 0);
        for (const m of s.mesh.material) m.emissiveIntensity = base + Math.sin(this.t * 2.2) * 0.08 + (this.hovered === s ? 0.22 : 0);
      }
    }
    this.dirty = this.dirty || moving || (!reduce && this.opts.ambient !== false);
    return moving;
  }

  private v = new THREE.Vector3();

  private emitAnchors() {
    if (!this.opts.onAnchors) return;
    const out: SnowpackAnchor[] = [];
    this.block.updateMatrixWorld(true);
    const project = (x: number, y: number, z: number, id: SnowpackAnchor['id']) => {
      this.v.set(x, y, z).applyMatrix4(this.block.matrixWorld).project(this.camera);
      out.push({ id, x: ((this.v.x + 1) / 2) * this.size.w, y: ((1 - this.v.y) / 2) * this.size.h });
    };
    this.bands.forEach((band, i) => {
      const g = this.layers[i];
      const y = (band.y0 + band.y1) / 2 + g.position.y;
      project(W / 2 + 0.02, y, D / 2 - 0.05, band.key);
    });
    const weak = this.slices.find((s) => s.weak);
    if (weak) {
      const band = this.bands[weak.layer];
      const y = (band.y0 + band.y1) / 2 + this.layers[weak.layer].position.y;
      project(weak.mesh.position.x, y, D / 2, 'weak');
    }
    this.opts.onAnchors(out);
  }

  private pickSlice(x: number, y: number): Slice | null {
    const ndc = new THREE.Vector2((x / this.size.w) * 2 - 1, -(y / this.size.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.slices.map((s) => s.mesh),
      false,
    );
    const hit = hits[0]?.object;
    return hit ? (this.slices.find((s) => s.mesh === hit) ?? null) : null;
  }
}

export { LAYER_ORDER };
