/**
 * Flurry's small sounds, made with the Web Audio API (no files to download): a soft two-note chime
 * when the panel opens, a rising one when something is done, and a low, short note for a problem.
 * They only play when the person has turned them on, and quietly.
 */
export type FlurrySound = 'open' | 'success' | 'error';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function note(a: AudioContext, freq: number, start: number, length: number, volume: number, type: OscillatorType = 'sine') {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

export function playFlurrySound(kind: FlurrySound): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  if (kind === 'open') {
    note(a, 1046.5, t, 0.35, 0.035);
    note(a, 1568, t + 0.08, 0.45, 0.025);
  } else if (kind === 'success') {
    note(a, 784, t, 0.3, 0.035);
    note(a, 988, t + 0.09, 0.3, 0.03);
    note(a, 1318.5, t + 0.18, 0.5, 0.028);
  } else {
    note(a, 330, t, 0.28, 0.03, 'triangle');
    note(a, 294, t + 0.12, 0.35, 0.025, 'triangle');
  }
}
