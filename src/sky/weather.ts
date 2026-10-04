import { type RGB, clamp, mix, rgb, rng } from './palette';
import { PROFILES, type Profile, type Weather } from './forecast';
import { noise } from '../scripts/clicky';

export { WEATHERS, forecast, isWeather, type Weather } from './forecast';

type Drop = { x: number; y: number; v: number; len: number };
type Flake = { x: number; y: number; v: number; ph: number; big: boolean };

export class WeatherFx {
  name: Weather;
  /** Current (eased) profile; read by the scene for clouds, gloom and wind. */
  p: Profile;
  /** 0..1 how much snow has settled on the ground. */
  snowCover = 0;
  flash = 0;
  private W = 1; private H = 1;
  private drops: Drop[] = [];
  private flakes: Flake[] = [];
  private splashes: { x: number; y: number; life: number }[] = [];
  private banks: { x: number; y: number; w: number; v: number }[] = [];
  private bolt: [number, number][] = [];
  private boltLife = 0;
  private nextStrike = 2;

  constructor(initial: Weather) {
    this.name = initial;
    this.p = { ...PROFILES[initial] };
    if (initial === 'snow') this.snowCover = 0.8; // it's been snowing a while
  }

  resize(W: number, H: number) {
    this.W = W; this.H = H;
    const r = rng(42);
    this.drops = Array.from({ length: Math.ceil((W * H) / 60) }, () => ({ x: r() * W, y: r() * H, v: 110 + r() * 60, len: 2 + Math.floor(r() * 3) }));
    this.flakes = Array.from({ length: Math.ceil((W * H) / 180) }, () => ({ x: r() * W, y: r() * H, v: 7 + r() * 12, ph: r() * 6.28, big: r() < 0.15 }));
    this.banks = Array.from({ length: Math.max(4, Math.round(W / 40)) }, () => ({
      x: r() * W, y: Math.round(H * (0.58 + r() * 0.36)), w: 30 + Math.floor(r() * 60), v: 0.6 + r() * 1.2,
    }));
  }

  get slant() { return Math.max(0, this.p.wind - 1) * 0.35; }
  private get nDrops() { return Math.floor(this.drops.length * clamp(this.p.rain / 1.6)); }
  private get nFlakes() { return Math.floor(this.flakes.length * clamp(this.p.snow)); }

  update(dt: number, t: number, ground: Int16Array) {
    const target = PROFILES[this.name], k = Math.min(1, dt * 0.4);
    for (const key of Object.keys(target) as (keyof Profile)[]) this.p[key] += (target[key] - this.p[key]) * k;
    this.snowCover = clamp(this.snowCover + (this.p.snow > 0.3 ? (dt / 90) * this.p.snow : -dt / 240));

    const { W } = this, slant = this.slant, gy = (x: number) => ground[clamp(x | 0, 0, W - 1)];
    for (let i = 0, n = this.nDrops; i < n; i++) {
      const d = this.drops[i];
      d.y += d.v * dt; d.x += slant * d.v * dt;
      if (d.y >= gy(d.x)) {
        if (this.splashes.length < 150 && Math.random() < 0.5) this.splashes.push({ x: d.x | 0, y: gy(d.x), life: 0.15 });
        d.y = -Math.random() * 30;
        d.x = Math.random() * (W + 40) - 40 * Math.sign(slant);
      }
    }
    this.splashes = this.splashes.filter((s) => (s.life -= dt) > 0);

    for (let i = 0, n = this.nFlakes; i < n; i++) {
      const f = this.flakes[i];
      f.x += (Math.sin(t * 1.3 + f.ph) * 5 + this.p.wind * 3) * dt;
      f.y += f.v * dt;
      if (f.x > W) f.x -= W;
      if (f.y >= gy(f.x)) { f.y = -2; f.x = Math.random() * W; }
    }

    for (const b of this.banks) { b.x += b.v * this.p.wind * dt; if (b.x > W) b.x -= W + b.w; }

    if (this.p.lightning > 0.5 && (this.nextStrike -= dt) <= 0) this.strike(ground);
    this.boltLife -= dt;
    this.flash = Math.max(0, this.flash - dt * 3.5);
  }

  strike(ground: Int16Array) {
    const r = Math.random, px: [number, number][] = [];
    let x = Math.floor(this.W * (0.1 + r() * 0.8)), y = Math.floor(this.H * 0.12);
    const branchAt = 4 + Math.floor(r() * 6);
    for (let step = 0; step < 300 && y < ground[clamp(x, 0, this.W - 1)]; step++) {
      for (let j = 1 + Math.floor(r() * 3); j > 0; j--) px.push([x, y++]);
      x += Math.floor(r() * 3) - 1;
      if (step === branchAt) {
        const dir = r() < 0.5 ? -1 : 1;
        for (let k = 0, bx = x, by = y; k < 8; k++) { px.push([bx, by++]); if (r() < 0.6) bx += dir; }
      }
    }
    this.bolt = px;
    this.boltLife = 0.22;
    this.flash = 1;
    this.nextStrike = 3 + r() * 9;
    noise({ dur: 0.25, freq: 1400, type: 'bandpass', gain: 0.06 });
    noise({ dur: 1.8, freq: 160, gain: 0.3, delay: 0.3 + r() });
  }

  drawPrecip(g: CanvasRenderingContext2D, n: number, bottom: RGB) {
    if (this.p.rain > 0.02) {
      g.fillStyle = rgb(mix(mix([170, 195, 235], bottom, 0.3), [90, 100, 140], n * 0.5), 0.8);
      const s = this.slant;
      for (let i = 0, N = this.nDrops; i < N; i++) {
        const d = this.drops[i], x = d.x | 0, y = d.y | 0;
        if (s < 0.25) g.fillRect(x, y - d.len, 1, d.len);
        else for (let j = 0; j < d.len; j++) g.fillRect(x - Math.round(j * s), y - j, 1, 1);
      }
      for (const sp of this.splashes) {
        const o = sp.life > 0.07 ? 1 : 2;
        g.fillRect(sp.x - o, sp.y - o, 1, 1); g.fillRect(sp.x + o, sp.y - o, 1, 1);
      }
    }
    if (this.p.snow > 0.02) {
      g.fillStyle = rgb(mix([248, 250, 255], [150, 158, 200], n * 0.6));
      for (let i = 0, N = this.nFlakes; i < N; i++) {
        const f = this.flakes[i], sz = f.big ? 2 : 1;
        g.fillRect(f.x | 0, f.y | 0, sz, sz);
      }
    }
  }

  drawFog(g: CanvasRenderingContext2D, n: number, bottom: RGB) {
    if (this.p.fog < 0.02) return;
    // Landscape layers are already tinted toward the fog colour; these are drifting banks on top.
    g.fillStyle = rgb(mix(mix(bottom, [240, 242, 248], 0.6), [70, 74, 100], n * 0.7), 0.22 * this.p.fog);
    for (const { x, y, w } of this.banks) {
      const bx = Math.round(x);
      g.fillRect(bx + 3, y, w - 6, 1);
      g.fillRect(bx, y + 1, w, 2);
      g.fillRect(bx + 2, y + 3, w - 4, 1);
    }
  }

  drawLightning(g: CanvasRenderingContext2D) {
    if (this.boltLife > 0) {
      g.fillStyle = '#b9b4ff';
      if (this.boltLife > 0.12) for (const [x, y] of this.bolt) if ((x + y) & 1) { g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); }
      g.fillStyle = '#fffbe8';
      for (const [x, y] of this.bolt) g.fillRect(x, y, 1, 1);
    }
    if (this.flash > 0) {
      g.fillStyle = `rgba(235,235,255,${this.flash * 0.45})`;
      g.fillRect(0, 0, this.W, this.H);
    }
  }
}
