/**
 * Renders a {@link ProjectModel} with three.js: a table of lanes on a time axis, one block per
 * task, a glass Today plane, milestone obelisks, dependency threads and estimated (ghost) work.
 *
 * Framework-free and imperative: the React view owns one instance and calls `setModel`,
 * `setTime`, `setOptions`, `setSelected`, `focus` and `view`. Rendering is on demand; the loop
 * only draws when something changed (camera, replay, hover), so an idle model costs nothing.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TaskStatus } from '@/api/types';
import { blockStateAt, blockZ, dayToIso, ROW_DEPTH, type ModelBlock, type ProjectModel } from './projectModel';
import { applyStudioEnvironment, disposeObject, easeInOutCubic, fitCameraView, makeLabel, prefersReducedMotion, readTheme, type SceneTheme } from './sceneUtils';
import { SNOW_PALETTES } from './snowpackKit';

/** World units per day. */
export const DAY_W = 0.28;
const BLOCK_DEPTH = ROW_DEPTH * 0.7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type ViewPreset = 'overview' | 'plan' | 'elevation' | 'today';

export interface SceneOptions {
  showProjection: boolean;
  showLinks: boolean;
  hideDone: boolean;
}

export interface SceneCallbacks {
  onHover?: (taskId: number | null, clientX: number, clientY: number) => void;
  onSelect?: (taskId: number | null) => void;
}

/**
 * `full`: the project's own model page (drag, zoom, pan, touch).
 * `exhibit`: a model shown inside a scrolling page (front page, sign-in, introduction). Dragging
 * with a mouse still turns it, but the wheel and touch gestures are left to the page, so the
 * model never traps scrolling.
 */
export type SceneInteraction = 'full' | 'exhibit';

interface BlockObjects {
  block: ModelBlock;
  solid: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  ghost: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  ghostEdges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  due: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  /** Red strip on the table from the due date to the replay time while the task is overdue. */
  late: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  z: number;
  visible: boolean;
}

interface LinkObjects {
  blockerId: number;
  blockedId: number;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

const LINK_POINTS = 28;
const EDGE_OPACITY = (t: SceneTheme) => (t.dark ? 0.55 : 0.22);

export class ProjectModelScene {
  private readonly container: HTMLElement;
  private readonly callbacks: SceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private theme: SceneTheme;
  private content = new THREE.Group();
  private blocks = new Map<number, BlockObjects>();
  private links: LinkObjects[] = [];
  private pickables: THREE.Object3D[] = [];
  private cursor: THREE.Group | null = null;
  private model: ProjectModel | null = null;
  private day = 0;
  private options: SceneOptions = { showProjection: true, showLinks: true, hideDone: false };
  private hovered: number | null = null;
  private selected: number | null = null;
  private focused: number | null = null;
  private related: Set<number> | null = null;
  private needsRender = true;
  private frame = 0;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; start: number; ms: number } | null = null;
  private downAt: { x: number; y: number } | null = null;
  /** The last camera preset, re-applied on resize until the user moves the camera themselves. */
  private preset: ViewPreset = 'overview';
  private userMoved = false;
  private disposed = false;
  private disposeEnvironment: () => void = () => {};
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 1.1);
  private readonly fill = new THREE.DirectionalLight(0xcfe2f5, 0.5);

  constructor(container: HTMLElement, callbacks: SceneCallbacks = {}, interaction: SceneInteraction = 'full') {
    this.container = container;
    this.callbacks = callbacks;
    this.theme = readTheme();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Lit like the snowpack: tone-mapped, a studio key, a cold fill and sky light.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.495; // never below the table
    this.controls.minDistance = 2;
    if (interaction === 'exhibit') {
      this.controls.enableZoom = false;
      this.controls.enablePan = false;
      this.controls.touches = { ONE: null, TWO: null };
      this.renderer.domElement.style.touchAction = 'pan-y';
    }
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => {
      this.tween = null;
      this.userMoved = true;
    });

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 6; // soft edges (PCF)
    this.fill.position.set(-30, 12, -20);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.content);
    this.disposeEnvironment = applyStudioEnvironment(this.renderer, this.scene, 0.35);
    this.applyThemeToScene();

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ public API

  setModel(model: ProjectModel, keepCamera = false): void {
    const firstTime = this.model === null;
    this.model = model;
    this.rebuild();
    this.setTime(this.day === 0 || firstTime ? model.todayDay : Math.min(this.day, model.span));
    if (firstTime || !keepCamera) this.view('overview', false);
  }

  setTime(day: number): void {
    this.day = day;
    this.updateBlocks();
    this.updateLinks();
    this.updateCursor();
    this.invalidate();
  }

  setOptions(options: Partial<SceneOptions>): void {
    this.options = { ...this.options, ...options };
    this.updateBlocks();
    this.updateLinks();
    this.invalidate();
  }

  /** Selection highlights the task and everything upstream and downstream of it. */
  setSelected(id: number | null): void {
    this.selected = id;
    this.related = id === null || !this.model ? null : this.relatedTo(id);
    this.updateBlocks();
    this.updateLinks();
    this.invalidate();
  }

  /** Keyboard focus: outlines the task and glides the camera target to it. */
  focus(id: number | null, moveCamera = true): void {
    this.focused = id;
    this.updateHighlights();
    const obj = id === null ? undefined : this.blocks.get(id);
    if (obj && moveCamera) {
      this.userMoved = true;
      const target = new THREE.Vector3();
      obj.solid.getWorldPosition(target);
      const offset = this.camera.position.clone().sub(this.controls.target);
      this.moveCamera(target.clone().add(offset), target, true);
    }
    this.invalidate();
  }

  view(preset: ViewPreset, animate = true): void {
    if (!this.model) return;
    this.preset = preset;
    this.userMoved = false;
    const w = this.model.span * DAY_W;
    const d = this.model.depth;
    // Everything worth seeing: lane names on the left, labels at the front, obelisks at the back.
    const box = new THREE.Box3(new THREE.Vector3(-4, 0, -1.6), new THREE.Vector3(w + 3, 2.4, d + 2.9));
    const centre = box.getCenter(new THREE.Vector3());
    let target = centre.clone().setY(0);
    let direction: THREE.Vector3;
    let fitBox = box;
    switch (preset) {
      case 'plan':
        direction = new THREE.Vector3(0, 1, 0.0001);
        break;
      case 'elevation':
        direction = new THREE.Vector3(0, 0.12, 1);
        target = centre.clone().setY(0.6);
        break;
      case 'today': {
        const x = this.model.todayDay * DAY_W;
        target = new THREE.Vector3(x, 0.4, d / 2);
        direction = new THREE.Vector3(-0.55, 0.55, 0.65);
        fitBox = new THREE.Box3(new THREE.Vector3(x - 5, 0, -1), new THREE.Vector3(x + 5, 2.4, d + 1));
        break;
      }
      default:
        // Wide, short panels get a lower eye so the table's depth doesn't use up the height.
        // One shallow, consistent angle: close enough to read, never a steep look down.
        direction = new THREE.Vector3(-0.16, 0.48, 0.86);
    }
    direction.normalize();
    const fit = fitCameraView(this.camera, fitBox, target, direction, 0.97, 0.94);
    this.controls.maxDistance = fit.distance * 3;
    this.moveCamera(fit.target.clone().add(direction.multiplyScalar(fit.distance)), fit.target, animate);
  }

  /** Screen position of a task (for anchoring HTML next to it), or null if off-screen. */
  screenPositionOf(id: number): { x: number; y: number } | null {
    const obj = this.blocks.get(id);
    if (!obj || !obj.visible) return null;
    const p = new THREE.Vector3();
    obj.solid.getWorldPosition(p);
    p.y += obj.solid.scale.y / 2 + 0.1;
    p.project(this.camera);
    if (p.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  refreshTheme(): void {
    this.theme = readTheme();
    this.applyThemeToScene();
    if (this.model) {
      this.rebuild();
      this.setTime(this.day);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    disposeObject(this.scene);
    this.disposeEnvironment();
    this.renderer.dispose();
    el.remove();
  }

  // ------------------------------------------------------------------ building

  private applyThemeToScene(): void {
    const t = this.theme;
    const bg = new THREE.Color(t.canvas);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 60, 260);
    const p = SNOW_PALETTES[t.dark ? 'dark' : 'light'];
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemi * 0.85;
    this.sun.color.set(p.key);
    this.sun.intensity = p.keyI * 0.8;
    this.fill.color.set(p.fill);
    this.fill.intensity = p.fillI;
    this.scene.environmentIntensity = p.env;
  }

  private rebuild(): void {
    const model = this.model;
    if (!model) return;
    this.scene.remove(this.content);
    disposeObject(this.content);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.blocks.clear();
    this.links = [];
    this.pickables = [];
    this.cursor = null;

    const t = this.theme;
    const w = model.span * DAY_W;
    const d = model.depth;

    // Light that covers the whole table, shadows included.
    this.sun.position.set(w * 0.3, Math.max(w, d) * 0.9, d + Math.max(w, d) * 0.5);
    this.sun.target.position.set(w / 2, 0, d / 2);
    const sc = this.sun.shadow.camera;
    const half = Math.max(w, d) * 0.75;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 0.5;
    sc.far = Math.max(w, d) * 3;
    sc.updateProjectionMatrix();

    // The table.
    const margin = 2.2;
    const table = new THREE.Mesh(
      new RoundedBoxGeometry(w + margin * 2, 0.2, d + margin * 2, 3, 0.08),
      new THREE.MeshStandardMaterial({ color: SNOW_PALETTES[t.dark ? 'dark' : 'light'].plinth, roughness: 0.62, metalness: 0 }),
    );
    table.position.set(w / 2, -0.1, d / 2);
    table.receiveShadow = true;
    this.content.add(table);

    // Grid: a line every Monday, a stronger one at each month, labels along the front edge.
    const weekPts: number[] = [];
    const monthPts: number[] = [];
    for (let day = 0; day <= model.span; day++) {
      const iso = dayToIso(model.originMs, day);
      const date = new Date(`${iso}T12:00:00`);
      const x = day * DAY_W;
      if (date.getDate() === 1) {
        monthPts.push(x, 0.002, -0.4, x, 0.002, d + 0.4);
        const label = makeLabel(`${MONTHS[date.getMonth()]} ${date.getFullYear()}`, { color: t.ink, size: 0.34, weight: 600 });
        label.position.set(x + 0.1, 0.05, d + 1.2);
        label.center.set(0, 0.5);
        this.content.add(label);
      } else if (date.getDay() === 1) {
        weekPts.push(x, 0.001, 0, x, 0.001, d);
        const label = makeLabel(String(date.getDate()), { color: t.muted, size: 0.24, weight: 500, uppercase: false });
        label.position.set(x, 0.05, d + 0.65);
        this.content.add(label);
      }
    }
    this.content.add(lineSegments(weekPts, t.line, 1));
    this.content.add(lineSegments(monthPts, t.lineStrong, 1));

    // Lanes: alternate tinted strips (so a row reads as one person), separators and names on the left.
    const lanePts: number[] = [];
    // Translucent so the table's shadows still show through.
    const stripMaterial = new THREE.MeshBasicMaterial({ color: t.dark ? t.surface2 : t.line, transparent: true, opacity: t.dark ? 0.9 : 0.55, depthWrite: false });
    model.lanes.forEach((lane, i) => {
      if (i % 2 === 1) {
        const depth = lane.rows * ROW_DEPTH + 0.5;
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, depth), stripMaterial);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(w / 2 - 0.3, 0.0015, lane.z + (lane.rows * ROW_DEPTH) / 2);
        this.content.add(strip);
      }
      if (i > 0) lanePts.push(-0.3, 0.003, lane.z - 0.35, w, 0.003, lane.z - 0.35);
      const label = makeLabel(lane.label, { color: t.ink2, size: 0.3, weight: 600 });
      label.center.set(1, 0.5);
      label.position.set(-0.5, 0.05, lane.z + (lane.rows * ROW_DEPTH) / 2);
      this.content.add(label);
    });
    this.content.add(lineSegments(lanePts, t.lineStrong, 1));

    // Today: a glass plane across all lanes.
    const glassH = 2.6;
    const todayX = model.todayDay * DAY_W;
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(d + 1.2, glassH),
      new THREE.MeshBasicMaterial({ color: t.accent, transparent: true, opacity: t.dark ? 0.14 : 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    glass.rotation.y = Math.PI / 2;
    glass.position.set(todayX, glassH / 2, d / 2);
    glass.renderOrder = 5;
    this.content.add(glass);
    this.content.add(
      lineSegments(
        [todayX, 0.004, -0.6, todayX, 0.004, d + 0.6, todayX, glassH, -0.6, todayX, glassH, d + 0.6, todayX, 0, -0.6, todayX, glassH, -0.6],
        t.accent,
        1,
      ),
    );
    // The Today label lies on the table at the very front, clear of the month, deadline and milestone labels.
    const todayLabel = makeLabel(`Today, ${fmt(dayToIso(model.originMs, model.todayDay))}`, { color: t.accent, size: 0.3, weight: 700, background: t.surface });
    todayLabel.position.set(todayX, 0.05, d + 2.6); // in front of the month and deadline labels
    this.content.add(todayLabel);

    // Deadline: a dashed fence.
    if (model.deadlineDay !== null) {
      const x = model.deadlineDay * DAY_W;
      const pts: number[] = [];
      for (let z = -0.6; z < d + 0.6; z += 0.5) pts.push(x, 0.005, z, x, 0.005, Math.min(z + 0.25, d + 0.6));
      pts.push(x, 0, -0.6, x, 1.8, -0.6);
      this.content.add(lineSegments(pts, t.ink, 1));
      const label = makeLabel(`Deadline, ${fmt(dayToIso(model.originMs, model.deadlineDay))}`, { color: t.ink, size: 0.28, weight: 700 });
      label.position.set(x + 0.1, 0.05, d + 1.9);
      label.center.set(0, 0.5);
      this.content.add(label);
    }

    // Milestones: obelisks in front of the lanes, a faint line across them.
    for (const m of model.milestones) {
      const x = m.day * DAY_W;
      const late = !m.completed && m.day < model.todayDay;
      const color = m.completed ? t.done : late ? t.danger : t.ink2;
      const obelisk = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 1.9, 0.14),
        new THREE.MeshStandardMaterial({ color, roughness: m.completed ? 0.35 : 0.7, metalness: m.completed ? 0.55 : 0 }),
      );
      obelisk.position.set(x, 0.95, -1.05);
      obelisk.castShadow = true;
      this.content.add(obelisk);
      this.content.add(lineSegments([x, 0.006, -0.9, x, 0.006, d], color, 0.6));
      const label = makeLabel(m.name, { color, size: 0.26, weight: 600 });
      label.position.set(x, 2.2, -1.05);
      this.content.add(label);
    }

    // Tasks.
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const unitEdges = new THREE.EdgesGeometry(unit);
    const edgeColor = t.dark ? '#000000' : t.ink;
    // Due date: a slim post at the front edge of the block's row.
    const pinGeometry = new THREE.BoxGeometry(0.04, 1, 0.04);
    for (const block of model.blocks) {
      const z = blockZ(model, block);
      const solid = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ color: t.todo, roughness: 0.6, metalness: 0 }));
      solid.castShadow = true;
      solid.receiveShadow = true;
      solid.userData.taskId = block.id;
      // Fine edges, like an architect's model: blocks stay legible where colours are close.
      const edges = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: EDGE_OPACITY(t) }));
      edges.raycast = () => {};
      solid.add(edges);
      const outline = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: t.accent, transparent: true, opacity: 1 }));
      outline.visible = false;
      outline.scale.setScalar(1.02);
      solid.add(outline);
      const ghost = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: t.ink, transparent: true, opacity: 0.07, depthWrite: false }));
      ghost.userData.taskId = block.id;
      const ghostEdges = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: t.ink2, transparent: true, opacity: 0.5 }));
      ghost.add(ghostEdges);
      const due = new THREE.Mesh(pinGeometry, new THREE.MeshBasicMaterial({ color: t.ink }));
      const late = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: t.danger, transparent: true, opacity: 0.85 }));
      this.content.add(solid, ghost, due, late);
      this.pickables.push(solid, ghost);
      this.blocks.set(block.id, { block, solid, edges, outline, ghost, ghostEdges, due, late, z, visible: true });
    }

    // Dependency threads (positions filled in updateLinks).
    for (const link of model.links) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINK_POINTS * 3), 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: t.ink2, transparent: true, opacity: 0.7 }));
      line.frustumCulled = false;
      this.content.add(line);
      this.links.push({ ...link, line });
    }

    // Replay cursor (shown when the replay time isn't today).
    const cursor = new THREE.Group();
    const cursorPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(d + 1.2, 1.4),
      new THREE.MeshBasicMaterial({ color: t.ink, transparent: true, opacity: t.dark ? 0.1 : 0.06, side: THREE.DoubleSide, depthWrite: false }),
    );
    cursorPlane.rotation.y = Math.PI / 2;
    cursorPlane.position.set(0, 0.7, d / 2);
    cursor.add(cursorPlane, lineSegments([0, 0.006, -0.6, 0, 0.006, d + 0.6], t.ink, 1));
    this.cursor = cursor;
    this.content.add(cursor);
  }

  // ------------------------------------------------------------------ updates

  private colorFor(status: TaskStatus | null): string {
    const t = this.theme;
    if (status === 'DONE') return t.done;
    if (status === 'IN_REVIEW') return t.review;
    if (status === 'IN_PROGRESS') return t.progress;
    return t.todo;
  }

  private updateBlocks(): void {
    const model = this.model;
    if (!model) return;
    const t = this.theme;
    for (const obj of this.blocks.values()) {
      const s = blockStateAt(obj.block, this.day, model.todayDay, this.options.showProjection);
      const hiddenDone = this.options.hideDone && s.status === 'DONE';
      obj.visible = s.visible && !hiddenDone;
      const dim = this.related !== null && !this.related.has(obj.block.id);

      obj.solid.visible = obj.visible && s.solid !== null;
      if (s.solid) {
        const len = Math.max(0.12, (s.solid.end - s.solid.start) * DAY_W);
        obj.solid.scale.set(len, s.solid.height, BLOCK_DEPTH);
        obj.solid.position.set(s.solid.start * DAY_W + len / 2, s.solid.height / 2, obj.z);
        const mat = obj.solid.material;
        mat.color.set(this.colorFor(s.status));
        // Matte everywhere: reflections would hide the relationships people are reading.
        mat.metalness = 0;
        mat.roughness = 0.85;
        mat.transparent = dim;
        mat.opacity = dim ? 0.18 : 1;
        mat.depthWrite = !dim;
        obj.edges.material.opacity = dim ? EDGE_OPACITY(t) * 0.3 : EDGE_OPACITY(t);
      }

      obj.ghost.visible = obj.visible && s.ghost !== null;
      if (s.ghost) {
        const len = Math.max(0.12, (s.ghost.end - s.ghost.start) * DAY_W);
        obj.ghost.scale.set(len, s.ghost.height, BLOCK_DEPTH);
        obj.ghost.position.set(s.ghost.start * DAY_W + len / 2, s.ghost.height / 2, obj.z);
        const doneByNow = s.ghost.completedByNow;
        obj.ghost.material.color.set(doneByNow ? t.done : t.ink);
        obj.ghost.material.opacity = (doneByNow ? 0.35 : 0.07) * (dim ? 0.4 : 1);
        obj.ghostEdges.material.color.set(obj.block.projected?.late ? t.danger : doneByNow ? t.done : t.ink2);
        obj.ghostEdges.material.opacity = dim ? 0.15 : 0.55;
      }

      obj.due.visible = obj.visible && obj.block.dueDay !== null && s.status !== 'DONE';
      if (obj.block.dueDay !== null) {
        const h = Math.max(0.45, (s.solid?.height ?? 0.4) + 0.3);
        obj.due.scale.set(1, h, 1);
        obj.due.position.set((obj.block.dueDay + 1) * DAY_W, h / 2, obj.z + BLOCK_DEPTH / 2 + 0.04);
        obj.due.material.color.set(s.overdue ? t.danger : t.ink);
        obj.due.material.transparent = dim;
        obj.due.material.opacity = dim ? 0.2 : 1;
      }

      // Overdue: a red strip on the table from the due date to the replay time.
      const lateFrom = obj.block.dueDay === null ? null : obj.block.dueDay + 1;
      const lateTo = Math.min(this.day, model.todayDay);
      obj.late.visible = obj.visible && s.overdue && lateFrom !== null && lateTo > lateFrom;
      if (obj.late.visible && lateFrom !== null) {
        const len = (lateTo - lateFrom) * DAY_W;
        obj.late.scale.set(len, 0.025, BLOCK_DEPTH * 1.15);
        obj.late.position.set(lateFrom * DAY_W + len / 2, 0.0125, obj.z);
        obj.late.material.opacity = dim ? 0.2 : 0.85;
      }
    }
    this.updateHighlights();
  }

  private endOf(obj: BlockObjects): number | null {
    if (!obj.visible) return null;
    const ghostEnd = obj.ghost.visible ? obj.ghost.position.x + obj.ghost.scale.x / 2 : null;
    const solidEnd = obj.solid.visible ? obj.solid.position.x + obj.solid.scale.x / 2 : null;
    return ghostEnd ?? solidEnd;
  }

  private startOf(obj: BlockObjects): number | null {
    if (!obj.visible) return null;
    if (obj.solid.visible && obj.solid.scale.y > 0.1) return obj.solid.position.x - obj.solid.scale.x / 2;
    if (obj.ghost.visible) return obj.ghost.position.x - obj.ghost.scale.x / 2;
    return obj.solid.visible ? obj.solid.position.x - obj.solid.scale.x / 2 : null;
  }

  private updateLinks(): void {
    const model = this.model;
    if (!model) return;
    const t = this.theme;
    for (const link of this.links) {
      const a = this.blocks.get(link.blockerId);
      const b = this.blocks.get(link.blockedId);
      const x0 = a ? this.endOf(a) : null;
      const x1 = b ? this.startOf(b) : null;
      // Dependencies appear for the selected task's chain; all of them only when asked for.
      const inChain = this.related !== null && this.related.has(link.blockerId) && this.related.has(link.blockedId);
      const visible = (this.options.showLinks || inChain) && a !== undefined && b !== undefined && x0 !== null && x1 !== null;
      link.line.visible = visible;
      if (!visible || !a || !b || x0 === null || x1 === null) continue;
      const y0 = Math.max(a.solid.visible ? a.solid.scale.y : 0, a.ghost.visible ? a.ghost.scale.y : 0) + 0.02;
      const y1 = Math.max(b.solid.visible ? b.solid.scale.y : 0, b.ghost.visible ? b.ghost.scale.y : 0) + 0.02;
      const start = new THREE.Vector3(x0, y0, a.z);
      const end = new THREE.Vector3(x1, y1, b.z);
      const lift = Math.max(y0, y1) + 0.5 + Math.min(2.5, start.distanceTo(end) * 0.08);
      const mid = new THREE.Vector3((x0 + x1) / 2, lift, (a.z + b.z) / 2);
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const attr = link.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = new THREE.Vector3();
      for (let i = 0; i < LINK_POINTS; i++) {
        curve.getPoint(i / (LINK_POINTS - 1), p);
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      link.line.geometry.computeBoundingSphere();

      const blockerState = blockStateAt(a.block, this.day, model.todayDay, false);
      const blockedState = blockStateAt(b.block, this.day, model.todayDay, false);
      const tension = blockerState.overdue && blockedState.status !== 'DONE';
      const released = blockerState.status === 'DONE';
      const involved = this.related === null || (this.related.has(link.blockerId) && this.related.has(link.blockedId));
      link.line.material.color.set(tension ? t.danger : released ? t.done : t.ink2);
      link.line.material.opacity = involved ? (released ? 0.55 : 0.9) : 0.12;
    }
  }

  private updateCursor(): void {
    const model = this.model;
    if (!model || !this.cursor) return;
    const away = Math.abs(this.day - model.todayDay) > 0.25;
    this.cursor.visible = away;
    this.cursor.position.x = this.day * DAY_W;
  }

  private updateHighlights(): void {
    for (const obj of this.blocks.values()) {
      const id = obj.block.id;
      const on = id === this.hovered || id === this.selected || id === this.focused;
      obj.outline.visible = on && obj.solid.visible;
      obj.outline.material.color.set(id === this.selected || id === this.focused ? this.theme.accent : this.theme.ink2);
    }
  }

  private relatedTo(id: number): Set<number> {
    const up = new Map<number, number[]>();
    const down = new Map<number, number[]>();
    for (const l of this.model?.links ?? []) {
      up.set(l.blockedId, [...(up.get(l.blockedId) ?? []), l.blockerId]);
      down.set(l.blockerId, [...(down.get(l.blockerId) ?? []), l.blockedId]);
    }
    const out = new Set<number>([id]);
    const walk = (start: number, edges: Map<number, number[]>) => {
      const stack = [start];
      while (stack.length) {
        const n = stack.pop()!;
        for (const next of edges.get(n) ?? []) {
          if (!out.has(next)) {
            out.add(next);
            stack.push(next);
          }
        }
      }
    };
    walk(id, up);
    walk(id, down);
    return out;
  }

  // ------------------------------------------------------------------ camera & loop

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, animate: boolean): void {
    if (!animate || prefersReducedMotion()) {
      this.tween = null;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.invalidate();
      return;
    }
    this.tween = { from: this.camera.position.clone(), to: position, fromT: this.controls.target.clone(), toT: target, start: performance.now(), ms: 750 };
    this.invalidate();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Keep the chosen framing when the panel changes size (e.g. the page finished laying out).
    if (this.model && !this.userMoved) this.view(this.preset, false);
    this.invalidate();
  }

  private invalidate(): void {
    this.needsRender = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    if (this.tween) {
      const k = Math.min(1, (performance.now() - this.tween.start) / this.tween.ms);
      const e = easeInOutCubic(k);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      this.controls.target.lerpVectors(this.tween.fromT, this.tween.toT, e);
      if (k >= 1) this.tween = null;
      this.needsRender = true;
    }
    const moved = this.controls.update();
    if (moved || this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  /** For tests and screenshots: draw a frame now. */
  renderNow(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ picking

  private pick(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables.filter((o) => o.visible), false);
    const id = hits[0]?.object.userData.taskId;
    return typeof id === 'number' ? id : null;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.buttons !== 0) return; // dragging the camera
    const id = this.pick(e.clientX, e.clientY);
    if (id !== this.hovered) {
      this.hovered = id;
      this.updateHighlights();
      this.invalidate();
    }
    this.renderer.domElement.style.cursor = id === null ? 'grab' : 'pointer';
    this.callbacks.onHover?.(id, e.clientX, e.clientY);
  };

  private onPointerLeave = (): void => {
    if (this.hovered !== null) {
      this.hovered = null;
      this.updateHighlights();
      this.invalidate();
    }
    this.callbacks.onHover?.(null, 0, 0);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.downAt) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 5) return; // it was a drag, not a click
    this.callbacks.onSelect?.(this.pick(e.clientX, e.clientY));
  };
}

function lineSegments(points: number[], color: string, opacity: number): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new THREE.LineSegments(geometry, material);
}

function fmt(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
