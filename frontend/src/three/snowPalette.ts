/**
 * The snowpack's colours, light and dark: the layers' faces, the fresh snow, the weak layer, the
 * plinth and the lights. Kept apart from the three.js code so the still drawings (shown before the
 * 3D scene loads, and without WebGL) can use the same colours without loading three.js.
 */
import type { LayerKey } from './snowpack';

export interface SnowPalette {
  plinth: string;
  plinthTop: string;
  face: Record<LayerKey, string>;
  snow: string;
  weak: string;
  weakGlow: string;
  dim: string;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: string;
  keyI: number;
  fill: string;
  fillI: number;
  flake: string;
  flakeA: number;
  shadow: number;
  env: number;
}

export const SNOW_PALETTES: Record<'light' | 'dark', SnowPalette> = {
  light: {
    plinth: '#eef2f5',
    plinthTop: '#f6f8fa',
    face: { done: '#2f7d61', review: '#cf9433', progress: '#3f82c2', todo: '#bcc7d1' },
    snow: '#fbfdff',
    weak: '#e0533a',
    weakGlow: '#ff6a4a',
    dim: '#d5dde4',
    hemiSky: '#f4f8fc',
    hemiGround: '#8a96a2',
    hemi: 1.35,
    key: '#ffffff',
    keyI: 2.3,
    fill: '#cfe2f5',
    fillI: 0.55,
    flake: '#ffffff',
    flakeA: 0.95,
    shadow: 0.32,
    env: 0.32,
  },
  dark: {
    plinth: '#16212b',
    plinthTop: '#1c2935',
    face: { done: '#2f9670', review: '#cf9636', progress: '#3f88cf', todo: '#53667a' },
    snow: '#dde7f0',
    weak: '#f0603f',
    weakGlow: '#ff7a55',
    dim: '#26323e',
    hemiSky: '#8fa8c4',
    hemiGround: '#0a131b',
    hemi: 0.95,
    key: '#e3ecff',
    keyI: 1.7,
    fill: '#3d6290',
    fillI: 0.7,
    flake: '#eef4fb',
    flakeA: 0.85,
    shadow: 0.38,
    env: 0.22,
  },
};
