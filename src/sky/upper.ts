// The upper sky, revealed when the camera tilts up (scroll up at the top of the page):
// the Milky Way and constellations at night; tall cumulus, cirrus and the odd plane by day.
// World coordinates: the normal view is y in [0, H]; this lives in y in [-pan, ~0.15H].
import { Pixels, dither, mix, rgb, smooth } from './palette';

const h2 = (x: number, y: number, s: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function vn2(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number, s: number) => vn2(x, y, s) * 0.55 + vn2(x * 2.1, y * 2.1, s + 1) * 0.3 + vn2(x * 4.3, y * 4.3, s + 2) * 0.15;

type BigCloud = { x: number; y: number; w: number; speed: number; px: [number, number, number][] };
type Wisp = { x: number; y: number; w: number; speed: number; px: [number, number][] };

// Constellations in a unit space (scaled at build time).
const BIG_DIPPER: [number, number][] = [[0, 0], [1, 0.15], [1.9, 0.35], [2.75, 0.45], [3, 1.1], [3.95, 1.25], [4.05, 0.55]];
const DIPPER_LINES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]];
const CASSIOPEIA: [number, number][] = [[0, 0], [0.9, 0.8], [1.9, 0.25], [2.9, 0.95], [3.8, 0.1]];

export class UpperSky {
  private W = 1; private H = 1; private pan = 1;
  private night: HTMLCanvasElement | null = null;
  private clouds: BigCloud[] = [];
  private wisps: Wisp[] = [];
  private plane: { x: number; y: number; dir: 1 | -1; trail: [number, number, number][]; emit: number } | null = null;
  private nextPlane = 6;

  /** Called on layout; the heavy textures are built lazily, the first time you look up. */
  reset(W: number, H: number, pan: number) {
    this.W = W; this.H = H; this.pan = pan;
    this.night = null; this.clouds = []; this.wisps = []; this.plane = null;
  }

  private build() {
    const { W, pan } = this;
    this.buildNight();
    // tall cumulus: many puffs on a flat base, shaded in four tones (lit from the upper left)
    this.clouds = Array.from({ length: Math.max(3, Math.round(W / 140)) }, (_, i) => {
      const w = 60 + Math.floor(h2(i, 1, 3) * 60), h = 22 + Math.floor(h2(i, 2, 3) * 10);
      const grid = new Uint8Array(w * h);
      const set = (x: number, y: number) => { if (x >= 0 && x < w && y >= 0 && y < h) grid[y * w + x] = 1; };
      for (let y = h - 5; y < h; y++) for (let x = 3; x < w - 3; x++) set(x, y);
      const puffs = 6 + Math.floor(h2(i, 3, 3) * 5);
      for (let p = 0; p < puffs; p++) {
        const r = 4 + Math.floor(h2(i, 10 + p, 3) * 7), cx = r + Math.floor(h2(i, 30 + p, 3) * (w - 2 * r));
        // puffs stack higher toward the middle, building a towering cumulus
        const cy = Math.round(h - 5 - r * 0.5 - h2(i, 50 + p, 3) * (h - 5 - r) * (1 - Math.abs(cx / w - 0.5) * 1.6));
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) set(cx + dx, cy + dy);
      }
      const px: BigCloud['px'] = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!grid[y * w + x]) continue;
        const edgeTop = y === 0 || !grid[(y - 1) * w + x], edgeLeft = x === 0 || !grid[y * w + x - 1];
        const below = y + 1 < h && grid[(y + 1) * w + x], nearTop = y > 1 && !grid[(y - 2) * w + x];
        const v = (y / h) * 0.85 + (x / w) * 0.3 + (dither(x, y) - 0.5) * 0.12;
        // sunlit tops and left sides, a cool grey underside
        const tone = edgeTop || nearTop || (edgeLeft && v < 0.6) ? 0 : !below || y >= h - 2 ? 3 : v < 0.62 ? 1 : v < 0.92 ? 2 : 3;
        px.push([x, y, tone]);
      }
      return { x: h2(i, 4, 3) * (W + w) - w, y: -pan * (0.3 + h2(i, 5, 3) * 0.55), w, speed: 0.3 + h2(i, 6, 3) * 0.4, px };
    });
    // cirrus: long, thin, slanted wisps
    this.wisps = Array.from({ length: Math.max(4, Math.round(W / 70)) }, (_, i) => {
      const w = 30 + Math.floor(h2(i, 7, 5) * 50), px: [number, number][] = [];
      for (let x = 0; x < w; x++) {
        const taper = Math.sin((Math.PI * x) / w);
        if (h2(x, i, 6) < 0.15 + taper * 0.85) px.push([x, Math.round(x * 0.12)]);
        if (h2(x, i, 7) < taper * 0.6) px.push([x, Math.round(x * 0.12) + (x % 7 < 3 ? -1 : 1)]);
      }
      return { x: h2(i, 8, 5) * (W + w) - w, y: -pan * (0.4 + h2(i, 9, 5) * 0.55), w, speed: 2.5 + h2(i, 10, 5) * 2.5, px };
    });
  }

  /** The Milky Way: a tilted glowing band with dust lanes, nebula tints and dense stars, plus two constellations. */
  private buildNight() {
    const { W, H, pan } = this, TH = pan + Math.round(H * 0.15);
    const c = document.createElement('canvas');
    c.width = W; c.height = TH;
    const g = c.getContext('2d')!;
    const glowPx = new Pixels(), corePx = new Pixels(), nebPx = new Pixels(), starPx = new Pixels();
    const hw = H * 0.17;
    for (let yy = 0; yy < TH; yy++) {
      const yw = yy - pan, fade = smooth(H * 0.12, -H * 0.05, yw);
      for (let x = 0; x < W; x++) {
        const yc = -pan * 0.55 + (x - W * 0.5) * 0.42, d = (yw - yc) / hw, base = Math.exp(-d * d * 2) * fade;
        const n = fbm(x / 26, yw / 26, 3);
        let glow = base * (0.45 + 0.75 * n);
        const lane = Math.exp(-(((yw - (yc + hw * 0.12 * Math.sin(x / 37))) / (hw * 0.16)) ** 2)) * smooth(0.35, 0.75, fbm(x / 18, yw / 18, 7));
        glow -= lane * 0.55 * base;
        const th = dither(x, yy);
        // colours close to the night sky, so the dithering reads as a soft glow rather than a checkerboard
        if (glow > 0.05 && th < glow * 0.7) glowPx.add(rgb(mix([28, 32, 78], [70, 62, 112], n)), x, yy);
        if (glow > 0.4 && th < (glow - 0.4) * 1.2) corePx.add(rgb(mix([96, 100, 158], [150, 132, 182], n)), x, yy);
        if (glow > 0.75 && th < (glow - 0.75) * 1.5) corePx.add('rgb(196,192,226)', x, yy);
        const neb = smooth(0.62, 0.8, fbm(x / 40, yw / 40, 11)) * base;
        if (neb > 0.02 && th < neb * 0.4) nebPx.add(fbm(x / 60, yw / 60, 13) > 0.5 ? 'rgb(120,64,112)' : 'rgb(52,100,120)', x, yy);
        if (h2(x, yy, 21) < 0.003 + base * 0.035) {
          const b = h2(x, yy, 22), col = b > 0.66 ? '#fff6dc' : b > 0.33 ? '#dfe8ff' : '#ffffff';
          starPx.add(col, x, yy);
          if (b > 0.97) { starPx.add(col, x - 1, yy); starPx.add(col, x + 1, yy); starPx.add(col, x, yy - 1); starPx.add(col, x, yy + 1); }
        }
      }
    }
    glowPx.flush(g); nebPx.flush(g); corePx.flush(g); starPx.flush(g);
    // constellations: faint dotted lines and bright stars
    const s = Math.max(6, Math.round(H * 0.05)), lines = new Pixels(), bright = new Pixels();
    const draw = (pts: [number, number][], links: [number, number][], ox: number, oy: number) => {
      const P = pts.map(([a, b]) => [Math.round(ox + a * s), Math.round(oy + b * s) + pan] as const);
      for (const [i, j] of links) {
        const [x0, y0] = P[i], [x1, y1] = P[j], steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let k = 2; k < steps - 1; k += 2) lines.add('rgba(170,190,255,0.35)', Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps));
      }
      for (const [x, y] of P) { bright.add('#ffffff', x - 1, y, 3, 1); bright.add('#ffffff', x, y - 1, 1, 3); }
    };
    draw(BIG_DIPPER, DIPPER_LINES, Math.min(W * 0.66, W - 5 * s), -pan * 0.82);
    draw(CASSIOPEIA, CASSIOPEIA.slice(1).map((_, i) => [i, i + 1]), Math.max(4, W * 0.1), -pan * 0.9);
    lines.flush(g); bright.flush(g);
    this.night = c;
  }

  update(dt: number, wind: number, day: boolean, looking: boolean) {
    if (!this.night) return;
    const W = this.W;
    for (const c of this.clouds) { c.x += c.speed * wind * dt; if (c.x > W + 4) c.x = -c.w; }
    for (const w of this.wisps) { w.x += w.speed * dt; if (w.x > W + 4) w.x = -w.w; }
    // the odd plane, drawing a contrail, on fair days while you're looking up
    if (!this.plane && day && looking && (this.nextPlane -= dt) <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.plane = { x: dir > 0 ? -6 : W + 6, y: -this.pan * (0.45 + Math.random() * 0.35), dir, trail: [], emit: 0 };
      this.nextPlane = 25 + Math.random() * 30;
    }
    const p = this.plane;
    if (p) {
      p.x += p.dir * 14 * dt;
      if ((p.emit -= dt) <= 0) { p.emit = 0.08; p.trail.push([p.x - p.dir * 3, p.y + 1, 0]); }
      for (const tr of p.trail) tr[2] += dt;
      p.trail = p.trail.filter((tr) => tr[2] < 9);
      if ((p.x < -40 || p.x > W + 40) && !p.trail.length) this.plane = null;
    }
  }

  /** Draw what's above the normal view. `cols`: cloud tones (highlight, light, mid, shadow). */
  draw(g: CanvasRenderingContext2D, nightAlpha: number, cols: string[], wispAlpha: number, showClouds: boolean) {
    if (!this.night) this.build();
    if (nightAlpha > 0.02) {
      g.globalAlpha = nightAlpha;
      g.drawImage(this.night!, 0, -this.pan);
      g.globalAlpha = 1;
    }
    const wisps = new Pixels(), wc = `rgba(255,255,255,${wispAlpha})`;
    for (const w of this.wisps) for (const [x, y] of w.px) wisps.add(wc, Math.round(w.x) + x, Math.round(w.y) + y);
    wisps.flush(g);
    if (showClouds) for (const c of this.clouds) {
      const px = new Pixels();
      for (const [x, y, tone] of c.px) px.add(cols[tone], Math.round(c.x) + x, Math.round(c.y) + y);
      px.flush(g);
    }
    const p = this.plane;
    if (p) {
      const trail = new Pixels();
      for (const [x, y, age] of p.trail) {
        const a = 1 - age / 9;
        if (dither(x | 0, y | 0) < a) trail.add('rgba(255,255,255,0.8)', x | 0, y | 0, 1, age > 2.5 ? 2 : 1);
      }
      trail.flush(g);
      g.fillStyle = '#e8e8ee';
      const x = Math.round(p.x), y = Math.round(p.y);
      g.fillRect(x - 2, y, 5, 1); g.fillRect(x - p.dir * 2, y - 1, 1, 1); g.fillRect(x, y + 1, 1, 1);
    }
  }
}

