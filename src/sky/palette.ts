export type RGB = [number, number, number];

export const hex = (s: string): RGB => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
export const mix = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
export const rgb = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither threshold in (0,1) for a pixel. Draw when value < threshold. */
export const dither = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** Pixel disc; with alpha < 1 it is dithered. */
export function disc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha = 1) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    if (alpha >= 1) { g.fillRect(cx - half, cy + dy, half * 2 + 1, 1); continue; }
    for (let x = cx - half; x <= cx + half; x++) if (dither(x, cy + dy) < alpha) g.fillRect(x, cy + dy, 1, 1);
  }
}

/** Dithered halo between radius r0 and r1, fading outward. */
export function glow(g: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, strength: number) {
  const R = Math.ceil(r1);
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, y);
    if (d <= r0 || d > r1) continue;
    const px = Math.round(cx + x), py = Math.round(cy + y);
    if (dither(px, py) < strength * (1 - (d - r0) / (r1 - r0))) g.fillRect(px, py, 1, 1);
  }
}

export const NIGHT: RGB = [12, 16, 38];

// [hour, zenith, horizon]
const KEYS: [number, RGB, RGB][] = ([
  [0, '#070a24', '#1a1f4e'],
  [4.5, '#0c1238', '#2a2a5e'],
  [6, '#2d3c84', '#e88a6a'],
  [7.5, '#4a8fe0', '#ffd6a0'],
  [10, '#2f7fe6', '#a9dcff'],
  [16, '#3584e4', '#c7e9ff'],
  [18, '#3b6bc4', '#ffc58a'],
  [19.5, '#3a2f7a', '#ff6f4a'],
  [20.75, '#16184a', '#5a3466'],
  [22, '#070a24', '#1a1f4e'],
  [24, '#070a24', '#1a1f4e'],
] as [number, string, string][]).map(([h, a, b]) => [h, hex(a), hex(b)]);

export function skyAt(h: number) {
  let i = 0;
  while (KEYS[i + 1][0] <= h) i++;
  const [h0, t0, b0] = KEYS[i], [h1, t1, b1] = KEYS[i + 1];
  const t = (h - h0) / (h1 - h0);
  return { top: mix(t0, t1, t), bottom: mix(b0, b1, t) };
}

/** Hard-banded CSS gradient of a whole day, for UI like the hour slider. */
export function dayStrip(bands = 48) {
  const stops: string[] = [];
  for (let i = 0; i < bands; i++) {
    const { top, bottom } = skyAt((i / bands) * 24);
    const c = rgb(mix(top, bottom, 0.55));
    stops.push(`${c} ${(i / bands) * 100}%`, `${c} ${((i + 1) / bands) * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
