// The Milky Way in the normal night sky, after long-exposure photos: a bluish-violet haze
// along a tilted band, a warm core bulge, blue-white star clouds, a dark rift splitting it,
// pink/orange/teal nebulae, and dense stars coloured by temperature. It fades out toward
// the mountains. Built once (lazily, the first night it's needed) into a canvas.
import { Pixels, dither, mix, rgb, smooth } from './palette';

const h2 = (x: number, y: number, s: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function vn2(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number, s: number) => vn2(x, y, s) * 0.55 + vn2(x * 2.1, y * 2.1, s + 1) * 0.3 + vn2(x * 4.3, y * 4.3, s + 2) * 0.15;

const BIG_DIPPER: [number, number][] = [[0, 0], [1, 0.15], [1.9, 0.35], [2.75, 0.45], [3, 1.1], [3.95, 1.25], [4.05, 0.55]];
const DIPPER_LINES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]];
const CASSIOPEIA: [number, number][] = [[0, 0], [0.9, 0.8], [1.9, 0.25], [2.9, 0.95], [3.8, 0.1]];
const STAR_COLS = ['#9bb0ff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffe1b8', '#ffc08a'];

export class MilkyWay {
  private W = 1; private H = 1;
  private tex: HTMLCanvasElement | null = null;
  private bright: [number, number, string][] = [];

  reset(W: number, H: number) { this.W = W; this.H = H; this.tex = null; this.bright = []; }

  private build() {
    const { W, H } = this, TH = Math.round(H * 0.66);
    const c = document.createElement('canvas');
    c.width = W; c.height = TH;
    const g = c.getContext('2d')!;
    const haze = new Pixels(), clouds = new Pixels(), glowCore = new Pixels(), neb = new Pixels(), starPx = new Pixels();
    const hw = H * 0.12, xc = W * 0.3;
    for (let y = 0; y < TH; y++) {
      const fade = smooth(H * 0.62, H * 0.36, y); // gone by the time it reaches the mountains
      for (let x = 0; x < W; x++) {
        const yc = H * 0.2 + (x - W * 0.5) * 0.3, d = (y - yc) / hw;
        const base = Math.exp(-d * d * 1.8) * fade;
        const core = Math.exp(-(((x - xc) / (W * 0.18)) ** 2)) * Math.exp(-d * d * 1.1) * fade;
        const n = fbm(x / 22, y / 22, 3);
        const rift = Math.exp(-(((y - (yc + hw * 0.1 * Math.sin(x / 29) + hw * 0.05 * Math.sin(x / 9))) / (hw * 0.17)) ** 2))
          * smooth(0.3, 0.7, fbm(x / 14, y / 14, 7));
        const glow = Math.max(0, base * (0.4 + 0.8 * n) + core * (0.25 + 0.4 * n) - rift * 0.85 * (base + core * 0.6));
        const th = dither(x, y), warm = Math.min(1, core * 1.6);
        if (glow > 0.05 && th < glow * 0.8) haze.add(rgb(mix(mix([34, 40, 98], [86, 76, 146], n), [120, 92, 80], warm * 0.6)), x, y);
        if (glow > 0.32 && th < (glow - 0.32) * 1.4) clouds.add(rgb(mix(mix([124, 136, 210], [196, 182, 226], n), [240, 205, 150], warm)), x, y);
        if (glow > 0.7 && th < (glow - 0.7) * 1.8) glowCore.add(rgb(mix([236, 232, 255], [255, 236, 196], warm)), x, y);
        const nb = smooth(0.58, 0.76, fbm(x / 30, y / 30, 11)) * (base * 0.6 + core);
        if (nb > 0.03 && th < nb * 0.6) {
          const k = fbm(x / 44, y / 44, 13);
          neb.add(k > 0.58 ? 'rgb(236,84,146)' : k > 0.42 ? 'rgb(246,150,86)' : 'rgb(72,186,214)', x, y);
        }
        if (h2(x, y, 21) < base * 0.05 + core * 0.04) {
          const b = h2(x, y, 22), col = STAR_COLS[Math.floor(h2(x, y, 23) * STAR_COLS.length)];
          if (b > 0.985) { starPx.add(col, x - 2, y, 5, 1); starPx.add(col, x, y - 2, 1, 5); starPx.add('#ffffff', x, y); this.bright.push([x, y, col]); }
          else if (b > 0.94) { starPx.add(col, x - 1, y, 3, 1); starPx.add(col, x, y - 1, 1, 3); }
          else starPx.add(b > 0.6 ? col : 'rgba(220,226,255,0.75)', x, y);
        }
      }
    }
    haze.flush(g); clouds.flush(g); neb.flush(g); glowCore.flush(g); starPx.flush(g);
    // two constellations, with faint dotted lines
    const s = Math.max(5, Math.round(H * 0.04)), lines = new Pixels(), stars = new Pixels();
    const draw = (pts: [number, number][], links: [number, number][], ox: number, oy: number) => {
      const P = pts.map(([a, b]) => [Math.round(ox + a * s), Math.round(oy + b * s)] as const);
      for (const [i, j] of links) {
        const [x0, y0] = P[i], [x1, y1] = P[j], steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let k = 2; k < steps - 1; k += 2) lines.add('rgba(170,190,255,0.3)', Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps));
      }
      for (const [x, y] of P) { stars.add('#ffffff', x - 1, y, 3, 1); stars.add('#ffffff', x, y - 1, 1, 3); }
    };
    draw(BIG_DIPPER, DIPPER_LINES, Math.min(W * 0.7, W - 5 * s), H * 0.05);
    draw(CASSIOPEIA, CASSIOPEIA.slice(1).map((_, i) => [i, i + 1]), Math.max(4, W * 0.05), H * 0.06);
    lines.flush(g); stars.flush(g);
    this.tex = c;
  }

  /** `alpha`: how dark and clear the night is (0 = invisible). */
  draw(g: CanvasRenderingContext2D, alpha: number) {
    if (alpha < 0.02) return;
    if (!this.tex) this.build();
    g.globalAlpha = alpha;
    g.drawImage(this.tex!, 0, 0);
    g.globalAlpha = 1;
  }

  /** Bloom: the band's glow and its brightest stars. */
  drawBloom(bg: CanvasRenderingContext2D, alpha: number) {
    if (alpha < 0.05 || !this.tex) return;
    bg.globalAlpha = alpha * 0.4;
    bg.drawImage(this.tex, 0, 0);
    bg.globalAlpha = 1;
    for (const [x, y, col] of this.bright) { bg.fillStyle = col; bg.fillRect(x - 1, y - 1, 3, 3); }
  }
}
