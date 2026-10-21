/**
 * The Prediction model's 3D chart: one lane per person, grouped by role. Along each lane, time
 * runs left to right and height is the share of that person's tasks approved so far, so lanes
 * are comparable whatever the workload (the dashed line on top of each lane is 100%).
 *
 * - Recorded history is solid, in the role's colour.
 * - From the Today plane on, the typical prediction (p50) continues as a translucent shape, with a
 *   paler band from the cautious (p90) to the optimistic (p10) prediction.
 * - A dashed line at the top of each lane is everything assigned to that person, so the gap to it
 *   is the work still open. A red line on the floor marks the deadline.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Role } from '@/api/types';
import type { PersonForecast, ProgressForecast } from '@/lib/progressForecast';
import { applyStudioEnvironment, disposeObject, fitCameraView, makeLabel, readTheme, type SceneTheme } from './sceneUtils';
import { contactShadowTexture, SNOW_PALETTES } from './snowpackKit';
import { dayToIso } from './projectModel';

const WIDTH = 16;
const HEIGHT = 2;
const LANE = 0.8;
const THICK = 0.38;
const GROUP_GAP = 0.45;

export interface ChartHover {
  person: string;
  x: number;
  y: number;
}

/** The colour of each role, from the page's CSS variables (so light and dark both work). */
export function roleColors(el: HTMLElement = document.documentElement): Record<Role | 'NONE', string> {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    OWNER: v('--role-owner', '#245b78'),
    MANAGER: v('--role-manager', '#b7791f'),
    MEMBER: v('--role-member', '#23704d'),
    VIEWER: v('--role-viewer', '#7a4fb5'),
    NONE: v('--role-none', '#7b8490'),
  };
}

export class ProgressChart3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
  private readonly controls: OrbitControls;
  private readonly group = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly container: HTMLElement;
  private readonly onHover: (h: ChartHover | null) => void;
  private theme: SceneTheme;
  private data: { forecast: ProgressForecast; people: PersonForecast[]; originMs: number } | null = null;
  private lanes: { name: string; meshes: THREE.Mesh[]; base: number[] }[] = [];
  private box = new THREE.Box3(new THREE.Vector3(-7, 0, -2), new THREE.Vector3(7, 3, 2));
  private hovered: string | null = null;
  private frame = 0;
  private dirty = true;
  private disposed = false;
  private readonly hemi = new THREE.HemisphereLight();
  private readonly key = new THREE.DirectionalLight();
  private readonly fill = new THREE.DirectionalLight();
  private readonly shadowTex = contactShadowTexture();
  private disposeEnvironment: () => void = () => {};

  constructor(container: HTMLElement, onHover: (h: ChartHover | null) => void) {
    this.container = container;
    this.onHover = onHover;
    this.theme = readTheme();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Lit like the snowpack: a studio key from the upper left, a cold fill, and sky light.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    const el = this.renderer.domElement;
    el.style.display = 'block';
    el.style.width = '100%';
    el.style.height = '100%';
    container.appendChild(el);

    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minAzimuthAngle = -Math.PI * 0.45;
    this.controls.maxAzimuthAngle = Math.PI * 0.45;
    this.controls.touches = { ONE: null, TWO: null };
    el.style.touchAction = 'pan-y';
    this.controls.addEventListener('change', () => (this.dirty = true));

    this.key.position.set(-6, 10, 8);
    this.fill.position.set(9, 3, -3);
    this.scene.add(this.hemi, this.key, this.fill, this.group);
    this.disposeEnvironment = applyStudioEnvironment(this.renderer, this.scene, 0.3);
    this.applyLights();

    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);
  }

  /** Shows these people's lanes (already filtered and ordered by the page). */
  setData(forecast: ProgressForecast, people: PersonForecast[], originMs: number): void {
    this.data = { forecast, people, originMs };
    this.build();
  }

  refreshTheme(): void {
    this.theme = readTheme();
    this.applyLights();
    this.build();
  }

  private applyLights(): void {
    const p = SNOW_PALETTES[this.theme.dark ? 'dark' : 'light'];
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemi;
    this.key.color.set(p.key);
    this.key.intensity = p.keyI * 0.9;
    this.fill.color.set(p.fill);
    this.fill.intensity = p.fillI;
    this.scene.environmentIntensity = p.env;
    this.dirty = true;
  }

  resetView(): void {
    this.frameCamera();
  }

  highlight(name: string | null): void {
    this.hovered = name;
    this.applyHighlight();
  }

  private build(): void {
    disposeObject(this.group);
    this.group.clear();
    this.lanes = [];
    if (!this.data) return;
    const { forecast: f, people, originMs } = this.data;
    const t = this.theme;
    const colors = roleColors();
    const span = Math.max(1, f.horizon - f.startDay);
    const x = (day: number) => -WIDTH / 2 + ((Math.min(f.horizon, Math.max(f.startDay, day)) - f.startDay) / span) * WIDTH;
    // Height is the share of the person's own tasks approved.
    let total = 1;
    const y = (count: number) => (count / total) * HEIGHT;

    // Lanes, grouped by role with a gap between groups.
    const zs: number[] = [];
    let z = 0;
    let lastRole: Role | null | undefined;
    const groupStarts: { role: Role | null; z: number }[] = [];
    for (const p of people) {
      if (lastRole !== undefined && p.role !== lastRole) z += GROUP_GAP;
      if (p.role !== lastRole) groupStarts.push({ role: p.role, z });
      zs.push(z);
      lastRole = p.role;
      z += LANE;
    }
    const depth = Math.max(LANE, z);
    const z0 = -depth / 2 + LANE / 2;

    // The plinth the lanes stand on (the snowpack's), its soft shadow, and a hairline a week.
    const pal = SNOW_PALETTES[t.dark ? 'dark' : 'light'];
    const floor = new THREE.Mesh(new RoundedBoxGeometry(WIDTH + 1.2, 0.12, depth + 0.9, 3, 0.05), new THREE.MeshStandardMaterial({ color: pal.plinth, roughness: 0.62 }));
    floor.position.set(0, -0.06, 0);
    this.group.add(floor);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry((WIDTH + 1.2) * 1.35, (depth + 0.9) * 2.1),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: pal.shadow * 0.8 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.119;
    shadow.renderOrder = -1;
    shadow.raycast = () => {};
    this.group.add(shadow);
    const gridMat = new THREE.LineBasicMaterial({ color: t.lineStrong, transparent: true, opacity: t.dark ? 0.55 : 0.7 });
    const grid: number[] = [];
    for (let d = Math.ceil(f.startDay / 7) * 7; d <= f.horizon; d += 7) grid.push(x(d), 0.002, -depth / 2 - 0.35, x(d), 0.002, depth / 2 + 0.35);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    this.group.add(new THREE.LineSegments(gridGeo, gridMat));

    people.forEach((p, i) => {
      const color = colors[p.role ?? 'NONE'];
      const zc = z0 + zs[i];
      total = Math.max(1, p.total);
      const meshes: THREE.Mesh[] = [];
      const base: number[] = [];
      const add = (shape: THREE.Shape, thickness: number, material: THREE.Material, opacity: number) => {
        const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
        geo.translate(0, 0, -thickness / 2);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.z = zc;
        mesh.userData.person = p.name;
        this.group.add(mesh);
        meshes.push(mesh);
        base.push(opacity);
      };

      if (p.total === 0) {
        // No tasks: a flat strip, so the person (and their role) still shows.
        const strip = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 0.02, THICK), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.35 }));
        strip.position.set(0, 0.01, zc);
        strip.userData.person = p.name;
        this.group.add(strip);
        meshes.push(strip);
        base.push(0.35);
      }
      // Recorded history: a solid area up to today.
      // A clean staircase: a step only where the count changes.
      const last = p.history[p.history.length - 1] ?? 0;
      if (last > 0) {
        const hist = new THREE.Shape();
        const first = p.history.findIndex((c) => c > 0);
        hist.moveTo(x(first), 0);
        let prev = 0;
        for (let d = first; d < p.history.length; d++) {
          if (p.history[d] === prev) continue;
          hist.lineTo(x(d), y(prev));
          hist.lineTo(x(d), y(p.history[d]));
          prev = p.history[d];
        }
        hist.lineTo(x(f.todayDay), y(prev));
        hist.lineTo(x(f.todayDay), 0);
        hist.lineTo(x(first), 0);
        add(hist, THICK, new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, transparent: true, opacity: 1 }), 1);
      } else if (p.total > 0) {
        // Nothing approved yet: a thin line on the floor up to today.
        const strip = new THREE.Mesh(new THREE.BoxGeometry(x(f.todayDay) - x(f.startDay), 0.02, THICK * 0.5), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6 }));
        strip.position.set((x(f.todayDay) + x(f.startDay)) / 2, 0.01, zc);
        strip.userData.person = p.name;
        this.group.add(strip);
        meshes.push(strip);
        base.push(0.6);
      }

      if (p.forecast.length > 1 && p.open > 0 && p.finish) {
        // Typical prediction (p50).
        const mid = new THREE.Shape();
        mid.moveTo(x(f.todayDay), 0);
        mid.lineTo(x(f.todayDay), y(p.approved));
        for (const d of p.forecast) mid.lineTo(x(Math.max(d.day, f.todayDay)), y(d.p50));
        mid.lineTo(x(f.horizon), 0);
        mid.lineTo(x(f.todayDay), 0);
        add(mid, THICK * 0.75, new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true, opacity: 0.34, depthWrite: false }), 0.34);
        // Range: from the cautious to the optimistic prediction.
        const band = new THREE.Shape();
        band.moveTo(x(Math.max(p.forecast[0].day, f.todayDay)), y(p.forecast[0].p90));
        for (const d of p.forecast) band.lineTo(x(Math.max(d.day, f.todayDay)), y(d.p10));
        for (const d of [...p.forecast].reverse()) band.lineTo(x(Math.max(d.day, f.todayDay)), y(d.p90));
        add(band, THICK, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }), 0.14);
      }

      // 100%: everything assigned to this person approved.
      if (p.total > 0) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x(f.startDay), y(p.total), zc), new THREE.Vector3(x(f.horizon), y(p.total), zc)]);
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: t.ink2, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.55 }));
        line.computeLineDistances();
        this.group.add(line);
      }

      const label = makeLabel(p.name, { color: t.ink, size: 0.3, weight: 600, uppercase: false, align: 'left' });
      label.position.set(WIDTH / 2 + 0.35, 0.12, zc);
      this.group.add(label);
      this.lanes.push({ name: p.name, meshes, base });
    });

    // Role group labels, on the left.
    for (const g of groupStarts) {
      const text = g.role === null ? 'Not assigned' : { OWNER: 'Owners', MANAGER: 'Managers', MEMBER: 'Members', VIEWER: 'Viewers' }[g.role];
      const label = makeLabel(text, { color: colors[g.role ?? 'NONE'], size: 0.26, weight: 700 });
      label.position.set(-WIDTH / 2 - 0.5, 0.12, z0 + g.z);
      label.center.set(1, 0.5);
      this.group.add(label);
    }

    // Today: a glass plane. Deadline: a red line across the floor.
    const plane = (at: number, color: string, opacity: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(depth + 0.7, HEIGHT + 0.5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.y = Math.PI / 2;
      m.position.set(at, (HEIGHT + 0.5) / 2, 0);
      m.raycast = () => {};
      this.group.add(m);
    };
    plane(x(f.todayDay), t.accent, 0.07);
    const todayLabel = makeLabel(`Today, ${short(dayToIso(originMs, f.todayDay))}`, { color: t.accent, size: 0.26, weight: 700 });
    todayLabel.position.set(x(f.todayDay), HEIGHT + 0.45, -depth / 2);
    this.group.add(todayLabel);
    if (f.deadlineDay !== null && f.deadlineDay >= f.startDay && f.deadlineDay <= f.horizon) {
      plane(x(f.deadlineDay), t.danger, 0.05);
      const dl = makeLabel(`Deadline, ${short(dayToIso(originMs, f.deadlineDay))}`, { color: t.danger, size: 0.26, weight: 700 });
      dl.position.set(x(f.deadlineDay), HEIGHT + 0.2, -depth / 2);
      this.group.add(dl);
    }

    // Date ticks along the front edge.
    const ticks = new Set<number>([f.startDay, Math.floor(f.todayDay), f.horizon]);
    const step = Math.max(7, Math.round(span / 6 / 7) * 7);
    for (let d = Math.ceil(f.startDay / step) * step; d < f.horizon; d += step) if (Math.abs(d - f.todayDay) > step / 3 && d - f.startDay > step / 3 && f.horizon - d > step / 3) ticks.add(d);
    for (const d of ticks) {
      const l = makeLabel(short(dayToIso(originMs, d)), { color: t.muted, size: 0.22, weight: 600 });
      l.position.set(x(d), 0.05, depth / 2 + 0.55);
      this.group.add(l);
    }
    // Height scale at the front-left: 0% and 100% approved.
    for (const [v, text] of [
      [0, '0%'],
      [HEIGHT, '100% approved'],
    ] as const) {
      const l = makeLabel(text, { color: t.muted, size: 0.16, weight: 600, uppercase: false });
      l.position.set(-WIDTH / 2 - 0.1, v + 0.05, depth / 2 - LANE / 2);
      l.center.set(1, 0.5);
      this.group.add(l);
    }

    this.box = new THREE.Box3(new THREE.Vector3(-WIDTH / 2 - 1.9, 0, -depth / 2 - 0.5), new THREE.Vector3(WIDTH / 2 + 2.4, HEIGHT + 0.6, depth / 2 + 0.8));
    this.frameCamera();
    this.applyHighlight();
  }

  private frameCamera(): void {
    const dir = new THREE.Vector3(0.2, 0.82, 1);
    const target = this.box.getCenter(new THREE.Vector3());
    const view = fitCameraView(this.camera, this.box, target, dir, 0.96, 0.9);
    this.controls.target.copy(view.target);
    this.camera.position.copy(view.target).addScaledVector(dir.normalize(), view.distance);
    this.controls.update();
    this.dirty = true;
  }

  private applyHighlight(): void {
    for (const lane of this.lanes) {
      const dim = this.hovered !== null && lane.name !== this.hovered;
      lane.meshes.forEach((m, i) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.opacity = dim ? lane.base[i] * 0.3 : lane.base[i];
        mat.transparent = true;
      });
    }
    this.dirty = true;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frameCamera();
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.buttons !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.lanes.flatMap((l) => l.meshes), false)[0];
    const name = (hit?.object.userData.person as string | undefined) ?? null;
    if (name !== this.hovered) {
      this.hovered = name;
      this.applyHighlight();
    }
    this.renderer.domElement.style.cursor = name ? 'default' : 'grab';
    this.onHover(name ? { person: name, x: e.clientX, y: e.clientY } : null);
  };

  private onPointerLeave = (): void => {
    this.hovered = null;
    this.applyHighlight();
    this.onHover(null);
  };

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    disposeObject(this.scene);
    this.shadowTex.dispose();
    this.disposeEnvironment();
    this.renderer.dispose();
    el.remove();
  }
}

function short(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
