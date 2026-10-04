// The upper sky, revealed when the camera tilts up (scroll up at the top of the page):
// the Milky Way and constellations at night; tall cumulus, cirrus and the odd plane by day.
// World coordinates: the normal view is y in [0, H]; this lives in y in [-pan, ~0.15H].
import { Pixels, dither, mix, rgb, smooth } from './palette';
import { cumulonimbus } from './clouds';

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
  private plane: { x: number; y: number; dir: 1 | -1; trail: [number, number, number][]; emit: number; t0: number } | null = null;
  private nextPlane = 20 + Math.random() * 30;
  /** The brightest Milky Way stars (world coords), which also glow in the bloom layer. */
  private brightStars: [number, number, string][] = [];

  /** Called on layout; the heavy textures are built lazily, the first time you look up. */
  reset(W: number, H: number, pan: number) {
    this.W = W; this.H = H; this.pan = pan;
    this.night = null; this.clouds = []; this.wisps = []; this.plane = null; this.brightStars = [];
  }

  private build() {
    const { W, pan } = this;
    this.buildNight();
    // towering cumulonimbus: big storm columns with anvil tops
    this.clouds = Array.from({ length: Math.max(2, Math.round(W / 220)) }, (_, i) => {
      const w = 120 + Math.floor(h2(i, 1, 3) * 60), h = Math.min(Math.round(pan * 0.7), 58 + Math.floor(h2(i, 2, 3) * 22));
      const look = cumulonimbus(w, h, h2(i, 3, 3) * 1000);
      return { x: (i / Math.max(2, Math.round(W / 220))) * W + h2(i, 4, 3) * 60 - 30, y: -pan * (0.2 + h2(i, 5, 3) * 0.15) - h * 0.55, w, speed: 0.25 + h2(i, 6, 3) * 0.3, px: look.px };
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

  /**
   * The Milky Way, after long-exposure photos: a bluish-violet haze along a tilted band, a
   * warm, bright core bulge, blue-white star clouds, a dark rift splitting it, pink and
   * teal nebulae, and dense stars coloured by temperature (blue-white to orange).
   */
  private buildNight() {
    const { W, H, pan } = this, TH = pan + Math.round(H * 0.15);
    const c = document.createElement('canvas');
    c.width = W; c.height = TH;
    const g = c.getContext('2d')!;
    const haze = new Pixels(), clouds = new Pixels(), glowCore = new Pixels(), neb = new Pixels(), starPx = new Pixels();
    const hw = H * 0.18, xc = W * 0.32;
    const STAR_COLS = ['#9bb0ff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffe1b8', '#ffc08a'];
    this.brightStars = [];
    for (let yy = 0; yy < TH; yy++) {
      const yw = yy - pan, fade = smooth(H * 0.12, -H * 0.05, yw);
      for (let x = 0; x < W; x++) {
        const yc = -pan * 0.55 + (x - W * 0.5) * 0.42, d = (yw - yc) / hw;
        const base = Math.exp(-d * d * 1.8) * fade;
        const core = Math.exp(-(((x - xc) / (W * 0.2)) ** 2)) * Math.exp(-d * d * 1.1) * fade; // the galactic bulge
        const n = fbm(x / 26, yw / 26, 3);
        // the great rift: a wandering dark lane down the middle of the band
        const rift = Math.exp(-(((yw - (yc + hw * 0.1 * Math.sin(x / 33) + hw * 0.05 * Math.sin(x / 11))) / (hw * 0.17)) ** 2))
          * smooth(0.3, 0.7, fbm(x / 16, yw / 16, 7));
        const glow = Math.max(0, base * (0.4 + 0.8 * n) + core * (0.25 + 0.4 * n) - rift * 0.85 * (base + core * 0.6));
        const th = dither(x, yy), warm = Math.min(1, core * 1.6);
        if (glow > 0.05 && th < glow * 0.8) haze.add(rgb(mix(mix([34, 40, 98], [86, 76, 146], n), [120, 92, 80], warm * 0.6)), x, yy);
        if (glow > 0.32 && th < (glow - 0.32) * 1.4) clouds.add(rgb(mix(mix([124, 136, 210], [196, 182, 226], n), [240, 205, 150], warm)), x, yy);
        if (glow > 0.7 && th < (glow - 0.7) * 1.8) glowCore.add(rgb(mix([236, 232, 255], [255, 236, 196], warm)), x, yy);
        // emission (pink) and reflection (teal) nebulae, mostly near the core
        const nb = smooth(0.58, 0.76, fbm(x / 34, yw / 34, 11)) * (base * 0.6 + core);
        if (nb > 0.03 && th < nb * 0.6) {
          const k = fbm(x / 50, yw / 50, 13);
          neb.add(k > 0.58 ? 'rgb(236,84,146)' : k > 0.42 ? 'rgb(246,150,86)' : 'rgb(72,186,214)', x, yy);
        }
        if (h2(x, yy, 21) < 0.004 + base * 0.05 + core * 0.04) {
          const b = h2(x, yy, 22), col = STAR_COLS[Math.floor(h2(x, yy, 23) * STAR_COLS.length)];
          if (b > 0.985) { // a bright star with diffraction spikes
            starPx.add(col, x - 2, yy, 5, 1); starPx.add(col, x, yy - 2, 1, 5); starPx.add('#ffffff', x, yy);
            this.brightStars.push([x, yw, col]);
          } else if (b > 0.94) { starPx.add(col, x - 1, yy, 3, 1); starPx.add(col, x, yy - 1, 1, 3); }
          else starPx.add(b > 0.6 ? col : 'rgba(220,226,255,0.75)', x, yy);
        }
      }
    }
    haze.flush(g); clouds.flush(g); neb.flush(g); glowCore.flush(g); starPx.flush(g);
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

  /** `pan`: how far the camera is looking up, in sky pixels (planes fly where you're looking). */
  update(dt: number, wind: number, fair: boolean, day: boolean, pan: number, t: number) {
    const W = this.W;
    for (const c of this.clouds) { c.x += c.speed * wind * dt; if (c.x > W + 4) c.x = -c.w; }
    for (const w of this.wisps) { w.x += w.speed * dt; if (w.x > W + 4) w.x = -w.w; }
    // now and then a plane crosses: a contrail by day, blinking lights at night
    if (!this.plane && fair && (this.nextPlane -= dt) <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y = pan > this.pan * 0.4 ? -pan + this.H * (0.1 + Math.random() * 0.3) : this.H * (0.06 + Math.random() * 0.22);
      this.plane = { x: dir > 0 ? -6 : W + 6, y, dir, trail: [], emit: 0, t0: t };
      this.nextPlane = 35 + Math.random() * 45;
    }
    const p = this.plane;
    if (p) {
      p.x += p.dir * 14 * dt;
      if (day && (p.emit -= dt) <= 0) { p.emit = 0.08; p.trail.push([p.x - p.dir * 3, p.y + 1, 0]); }
      for (const tr of p.trail) tr[2] += dt;
      p.trail = p.trail.filter((tr) => tr[2] < 9);
      if ((p.x < -40 || p.x > W + 40) && !p.trail.length) this.plane = null;
    }
  }

  /** Draw what's above the normal view. `cols`: the five cloud tones. */
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
  }

  /** The plane: silver with a contrail by day; at night a dark shape with red/green lights and a white strobe. */
  drawPlane(g: CanvasRenderingContext2D, t: number, n: number) {
    const p = this.plane;
    if (!p) return;
    const trail = new Pixels();
    for (const [x, y, age] of p.trail) {
      const a = (1 - age / 9) * (1 - n);
      if (dither(x | 0, y | 0) < a) trail.add('rgba(255,255,255,0.8)', x | 0, y | 0, 1, age > 2.5 ? 2 : 1);
    }
    trail.flush(g);
    const x = Math.round(p.x), y = Math.round(p.y);
    g.fillStyle = n > 0.5 ? '#1c1e2e' : '#e8e8ee';
    g.fillRect(x - 2, y, 5, 1); g.fillRect(x - p.dir * 2, y - 1, 1, 1); g.fillRect(x, y + 1, 1, 1);
    if (n > 0.5) this.lights(g, t);
  }

  private lights(g: CanvasRenderingContext2D, t: number) {
    const p = this.plane!, x = Math.round(p.x), y = Math.round(p.y), k = t - p.t0;
    if (Math.floor(k * 1.2) % 2 === 0) { g.fillStyle = '#ff3b3b'; g.fillRect(x - p.dir * 2, y, 1, 1); }
    if (Math.floor(k * 1.2 + 1) % 2 === 0) { g.fillStyle = '#3bff6a'; g.fillRect(x + p.dir * 2, y, 1, 1); }
    if (k % 1.3 < 0.1) { g.fillStyle = '#ffffff'; g.fillRect(x, y - 1, 1, 1); }
  }

  /** Bloom: the Milky Way's glow and its brightest stars (when looking up), and plane lights at night. */
  drawBloom(bg: CanvasRenderingContext2D, t: number, nightAlpha: number, looking: boolean, n: number) {
    if (looking && this.night && nightAlpha > 0.05) {
      bg.globalAlpha = nightAlpha * 0.45;
      bg.drawImage(this.night, 0, -this.pan);
      bg.globalAlpha = 1;
      for (const [x, y, col] of this.brightStars) { bg.fillStyle = col; bg.fillRect(x - 1, y - 1, 3, 3); }
    }
    if (this.plane && n > 0.5) this.lights(bg, t);
  }
}
