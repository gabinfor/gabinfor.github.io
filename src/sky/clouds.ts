// Cumulus clouds, built the way real ones look: a heap of rounded lobes (cauliflower
// tops, bigger at the bottom-middle), a flat base, lit from the sun's side so each lobe
// gets its own bright rim and shaded core, a darker underside, and soft dithered edges.
import { dither, rng } from './palette';

/** tones: 0 highlight, 1 light, 2 mid, 3 shade, 4 base shadow. */
export type CloudLook = { w: number; h: number; px: [number, number, number][]; runs: [number, number, number, number][] };

export function toRuns(w: number, h: number, px: [number, number, number][]): CloudLook {
  const grid = new Int8Array(w * h).fill(-1);
  for (const [x, y, t] of px) grid[y * w + x] = t;
  const runs: CloudLook['runs'] = [];
  for (let y = 0; y < h; y++) {
    let run: [number, number, number, number] | null = null;
    for (let x = 0; x <= w; x++) {
      const t = x < w ? grid[y * w + x] : -1;
      if (run && run[3] !== t) { runs.push(run); run = null; }
      if (t >= 0 && !run) run = [x, y, 0, t];
      if (run) run[2]++;
    }
  }
  return { w, h, px, runs };
}

/**
 * @param tall 0 = a fair-weather puff, 1 = a towering cumulus
 * @param lightX -1 sun on the left .. 1 sun on the right
 */
export function cumulus(w: number, h: number, seed: number, tall = 0, lightX = -0.5): CloudLook {
  const r = rng(Math.floor(seed * 9973) + 7);
  const base = h - 2; // flat bottom
  const lobes: [number, number, number][] = [];
  // bottom row: overlapping lobes (sized from their spacing so they always merge), biggest mid-cloud
  const n = Math.max(2, Math.round(w / 10)), spacing = (w * 0.76) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    // a dome: big lobes in the middle, small ones at the ends (but always overlapping)
    const dome = Math.sin(Math.PI * (0.08 + 0.84 * f)) ** 0.8;
    const rad = Math.max(spacing * 0.62, h * (0.18 + 0.38 * dome)) * (0.85 + 0.3 * r());
    lobes.push([w * (0.12 + 0.76 * f) + (r() - 0.5) * spacing * 0.4, base - rad * 0.4, rad]);
  }
  // upper rows: smaller lobes heaped toward the middle (taller clouds get more)
  const levels = 1 + Math.round(tall * 2);
  for (let l = 1; l <= levels; l++) {
    const m = Math.max(1, n - l - Math.round(r()));
    for (let i = 0; i < m; i++) {
      const f = m === 1 ? 0.5 : i / (m - 1), spread = 0.7 - l * 0.15;
      const rad = Math.min(h * 0.35, Math.max(spacing * 0.45, h * (0.24 + 0.08 * tall))) * (0.7 + 0.4 * r()) * (1 - l * 0.1);
      lobes.push([w * (0.5 + (f - 0.5) * spread) + (r() - 0.5) * spacing * 0.6, base - h * (0.2 + l * (0.2 + 0.1 * tall)) - rad * 0.1 + (r() - 0.5) * 2, rad]);
    }
  }
  // small fair-weather puffs: an explicit dome (a big central lobe and two shoulders)
  if (tall === 0 && w < 40) {
    lobes.length = 0;
    const c = w * (0.45 + (r() - 0.5) * 0.1);
    lobes.push([c, base - h * 0.42, h * 0.5]);
    lobes.push([w * 0.22, base - h * 0.2, h * (0.3 + 0.08 * r())]);
    lobes.push([w * 0.76, base - h * 0.24, h * (0.32 + 0.08 * r())]);
    if (r() < 0.6) lobes.push([c + h * 0.35, base - h * 0.5, h * 0.3]);
  }
  // keep every lobe inside the canvas, so tops round off instead of being cut flat
  for (const lb of lobes) { lb[2] = Math.min(lb[2], h * 0.6); lb[1] = Math.max(lb[1], lb[2] + 0.5); }
  // a solid base slab with rounded ends ties the lobes into one body
  const slabTop = base - h * 0.16, slabL = w * 0.1, slabR = w * 0.9, slabRad = base - slabTop;
  const inSlab = (x: number, y: number) => y >= slabTop && y <= base && x >= slabL - slabRad && x <= slabR + slabRad
    && (x >= slabL || (x - slabL) ** 2 + (y - base) ** 2 <= slabRad * slabRad) && (x <= slabR || (x - slabR) ** 2 + (y - base) ** 2 <= slabRad * slabRad);
  // light from above and to the sun's side, a little toward the viewer
  const L = [lightX * 0.55, -0.72, 0.42], ll = Math.hypot(...L);
  const lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;
  // (x, y) are pixel centres; the base row is inside, everything below it is not
  const inside = (x: number, y: number) => y < base + 1 && (inSlab(x, Math.min(y, base)) || lobes.some(([cx, cy, rad]) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad));
  const gcx = w / 2, gcy = base - h * 0.45;
  const px: [number, number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x + 0.5, y + 0.5)) continue;
    // lobe detail: the normal of the front-most lobe here...
    let best = -Infinity, nx = 0, ny = 0;
    for (const [cx, cy, rad] of lobes) {
      const dx = (x + 0.5 - cx) / rad, dy = (y + 0.5 - cy) / rad;
      if (dx * dx + dy * dy > 1) continue;
      const score = -cy + rad * 0.3; // higher (and bigger) lobes sit in front
      if (score > best) { best = score; nx = dx; ny = dy; }
    }
    // ...blended with the shape of the whole cloud, so it reads as one mass, not a row of balls
    const gx = (x + 0.5 - gcx) / (w * 0.5), gy = (y + 0.5 - gcy) / (h * 0.6);
    const bx = nx * 0.45 + gx * 0.55, by = ny * 0.45 + gy * 0.55;
    const bz = Math.sqrt(Math.max(0.05, 1 - bx * bx - by * by)), bl = Math.hypot(bx, by, bz);
    let v = Math.max(0, (bx * lx + by * ly + bz * lz) / bl);
    v = 0.3 + 0.7 * v;
    v *= 0.66 + 0.34 * (1 - y / h) ** 0.6;                 // the lower body sits in its own shadow
    if (y >= base - 1) v *= 0.75;                           // flat, darker base
    // soft, slightly broken edges on the sides and underside (sunlit tops stay crisp)
    const sideEdge = !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y + 1.5);
    if (sideEdge && inside(x + 0.5, y - 0.5) && dither(x, y) > 0.86) continue;
    const tone = Math.min(4, Math.max(0, Math.floor((1 - v) * 5.2 + (dither(x, y) - 0.5) * 0.9)));
    px.push([x, y, tone]);
  }
  return toRuns(w, h, px);
}
