// The Milky Way in the normal night sky, modelled on a long-exposure photo: the band rises
// steeply from near the horizon (just right of centre) to the upper left; it is warmest and
// brightest low down (soft salmon/beige), lavender-grey higher up, split by clumpy dark dust
// lanes with a rift along its right side; the whole sky is dense with faint stars plus a few
// bright blue-white and orange ones; a warm amber glow sits on the horizon. Muted colours,
// no saturated nebula blobs. Built once, lazily, the first night it's needed.
import { Pixels, dither, mix, rgb, smooth } from './palette';

const h2 = (x: number, y: number, s: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function vn2(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number, s: number) => vn2(x, y, s) * 0.55 + vn2(x * 2.1, y * 2.1, s + 1) * 0.3 + vn2(x * 4.3, y * 4.3, s + 2) * 0.15;

const BRIGHT_COLS = ['#a9bcff', '#d6e0ff', '#ffffff', '#fff1dc', '#ffd2a0'];

export class MilkyWay {
  private W = 1; private H = 1;
  private tex: HTMLCanvasElement | null = null;
  private bright: [number, number, string][] = [];

  reset(W: number, H: number) { this.W = W; this.H = H; this.tex = null; this.bright = []; }

  private build() {
    const { W, H } = this, TH = Math.round(H * 0.68);
    const c = document.createElement('canvas');
    c.width = W; c.height = TH;
    const g = c.getContext('2d')!;
    const L1 = new Pixels(), L2 = new Pixels(), L3 = new Pixels(), L4 = new Pixels(), field = new Pixels(), bright = new Pixels(), horizon = new Pixels();
    // the band's centre line: from near the horizon, right of centre, up to the top left
    const x0 = W * 0.62, y0 = H * 0.5, x1 = W * 0.26, y1 = -H * 0.08; // base just above the mountain tops
    const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < W; x++) {
        const th = dither(x, y);
        // position along the band (t: 0 at the horizon, 1 at the top) and across it (d)
        const px = x - x0, py = y - y0, along = px * ux + py * uy, t = along / len;
        const wob = Math.sin(t * 7.5) * H * 0.012 + Math.sin(t * 17) * H * 0.006;
        const hw = H * (0.17 - 0.07 * t), d = (px * uy - py * ux + wob) / hw;
        const n = fbm(x / 16, y / 16, 3), n2 = fbm(x / 7, y / 7, 5);
        // brighter and warmer low down, toward the core; clumpy star clouds
        const bright01 = 0.6 + 0.6 * (1 - Math.min(1, Math.max(0, t)));
        let glow = Math.exp(-d * d * 1.6) * (0.35 + 0.75 * n * (0.7 + 0.5 * n2)) * bright01;
        // dust: a rift along the right side of the band, plus dark clumps scattered through it
        const rift = Math.exp(-(((d - 0.28 - 0.12 * Math.sin(t * 11)) / 0.2) ** 2)) * smooth(0.3, 0.65, fbm(x / 9, y / 9, 7));
        const clumps = smooth(0.56, 0.74, fbm(x / 8, y / 8, 9)) * Math.exp(-d * d);
        glow *= 1 - 0.75 * rift - 0.55 * clumps;
        if (t < -0.02 || t > 1.05) glow = 0;
        const warm = smooth(0.62, 0, t) * (0.6 + 0.4 * n);
        if (glow > 0.05 && th < glow * 1.05) L1.add(rgb(mix([30, 29, 58], [50, 44, 74], n)), x, y);
        if (glow > 0.24 && th < (glow - 0.24) * 1.7) L2.add(rgb(mix(mix([86, 82, 120], [118, 106, 136], n2), [146, 108, 108], warm)), x, y);
        if (glow > 0.44 && th < (glow - 0.44) * 1.9) L3.add(rgb(mix([160, 152, 186], [208, 168, 158], warm)), x, y);
        if (glow > 0.66 && th < (glow - 0.66) * 2.2) L4.add(rgb(mix([214, 210, 232], [236, 206, 196], warm)), x, y);
        // the star field: dense faint stars everywhere, many more inside the band
        const r = h2(x, y, 21);
        if (r < 0.02 + glow * 0.08) {
          const b = h2(x, y, 22);
          if (b > 0.995) { // a few bright stars, with short spikes
            const col = BRIGHT_COLS[Math.floor(h2(x, y, 23) * BRIGHT_COLS.length)];
            bright.add(col, x - 1, y, 3, 1); bright.add(col, x, y - 1, 1, 3); this.bright.push([x, y, col]);
          } else field.add(b > 0.8 ? '#e6eaff' : b > 0.45 ? '#a7b0d4' : '#6a74a0', x, y);
        }
        // light pollution: a warm amber glow behind the mountains, a little left of the band
        const amber = Math.exp(-(((x - W * 0.47) / (W * 0.14)) ** 2)) * smooth(H * 0.3, H * 0.5, y); // peeks over the ridge
        if (amber > 0.04 && th < amber * 0.75) horizon.add(rgb(mix([34, 30, 52], [120, 76, 44], amber)), x, y); // close to the sky colour, so it reads as a soft glow
      }
    }
    horizon.flush(g); L1.flush(g); L2.flush(g); L3.flush(g); L4.flush(g); field.flush(g); bright.flush(g);
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
