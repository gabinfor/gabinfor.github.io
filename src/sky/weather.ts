import { type RGB, clamp, mix, rgb, rng } from './palette';
import { PROFILES, type Profile, type Weather } from './forecast';
import { noise } from '../scripts/clicky';

export { WEATHERS, forecast, isWeather, type Weather } from './forecast';

// Precipitation lives on depth layers so it falls across the whole valley, not just
// the farthest ridge: 0 = mountains, 1..3 = hills far→near, 4 = foreground (in front of
// everything). Each particle stops at its own layer's surface and is drawn right after
// that layer, so nearer hills hide it. Distant layers are slower, shorter and fainter.
const LAYERS = [
  { share: 0.14, speed: 0.5, len: 1, fade: 0.55 },
  { share: 0.18, speed: 0.6, len: 2, fade: 0.45 },
  { share: 0.2, speed: 0.72, len: 2, fade: 0.3 },
  { share: 0.22, speed: 0.86, len: 3, fade: 0.15 },
  { share: 0.26, speed: 1.05, len: 4, fade: 0 },
];
const pickLayer = (r: number) => { let acc = 0; for (let i = 0; i < LAYERS.length; i++) if (r < (acc += LAYERS[i].share)) return i; return LAYERS.length - 1; };

type Drop = { x: number; y: number; v: number; len: number; layer: number };
type Flake = { x: number; y: number; v: number; ph: number; size: number; layer: number };

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
  private splashes: { x: number; y: number; life: number; layer: number }[] = [];
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
    this.drops = Array.from({ length: Math.ceil((W * H) / 60) }, () => {
      const layer = pickLayer(r()), L = LAYERS[layer];
      return { x: r() * W, y: r() * H, v: (110 + r() * 60) * L.speed, len: L.len, layer };
    });
    this.flakes = Array.from({ length: Math.ceil((W * H) / 150) }, () => {
      const layer = pickLayer(r());
      return { x: r() * W, y: r() * H, v: (7 + r() * 12) * LAYERS[layer].speed, ph: r() * 6.28, size: layer === 4 || (layer === 3 && r() < 0.3) ? 2 : 1, layer };
    });
    this.banks = Array.from({ length: Math.max(4, Math.round(W / 40)) }, () => ({
      x: r() * W, y: Math.round(H * (0.58 + r() * 0.36)), w: 30 + Math.floor(r() * 60), v: 0.6 + r() * 1.2,
    }));
  }

  get slant() { return Math.max(0, this.p.wind - 1) * 0.35; }
  private get nDrops() { return Math.floor(this.drops.length * clamp(this.p.rain / 1.6)); }
  private get nFlakes() { return Math.floor(this.flakes.length * clamp(this.p.snow)); }

  /** `surfaces`: mountains then hills far→near; layer 4 falls to the bottom of the screen. */
  update(dt: number, t: number, surfaces: Int16Array[]) {
    const target = PROFILES[this.name], k = Math.min(1, dt * 0.4);
    for (const key of Object.keys(target) as (keyof Profile)[]) this.p[key] += (target[key] - this.p[key]) * k;
    this.snowCover = clamp(this.snowCover + (this.p.snow > 0.3 ? (dt / 90) * this.p.snow : -dt / 240));

    const { W, H } = this, slant = this.slant;
    const gy = (x: number, layer: number) => (layer < surfaces.length ? surfaces[layer][clamp(x | 0, 0, W - 1)] : H + 4);
    for (let i = 0, n = this.nDrops; i < n; i++) {
      const d = this.drops[i];
      d.y += d.v * dt; d.x += slant * d.v * dt;
      const floor = gy(d.x, d.layer);
      if (d.y >= floor) {
        if (d.layer < surfaces.length && this.splashes.length < 200 && Math.random() < 0.5)
          this.splashes.push({ x: d.x | 0, y: floor, life: 0.15, layer: d.layer });
        // Respawn far enough upwind that slanted rain still reaches the downwind corner.
        const drift = slant * (H + 30);
        d.y = -Math.random() * 30;
        d.x = Math.random() * (W + drift) - drift;
      }
    }
    this.splashes = this.splashes.filter((s) => (s.life -= dt) > 0);

    for (let i = 0, n = this.nFlakes; i < n; i++) {
      const f = this.flakes[i], depth = LAYERS[f.layer].speed;
      f.x += (Math.sin(t * 1.3 + f.ph) * 5 + this.p.wind * 3) * depth * dt;
      f.y += f.v * dt;
      if (f.x > W) f.x -= W;
      if (f.y >= gy(f.x, f.layer)) { f.y = -2; f.x = Math.random() * W; }
    }

    for (const b of this.banks) { b.x += b.v * this.p.wind * dt; if (b.x > W) b.x -= W + b.w; }

    if (this.p.lightning > 0.5 && (this.nextStrike -= dt) <= 0) this.strike(surfaces[Math.random() < 0.5 ? 0 : 1]);
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
    noise({ dur: 1.8, freq: 160, gain: 0.3, delay: 0.3 + r() }); // distant rumble only
  }

  /** Draw the rain and snow belonging to one depth layer. */
  drawPrecip(g: CanvasRenderingContext2D, layer: number, n: number, bottom: RGB) {
    const fade = LAYERS[layer].fade;
    if (this.p.rain > 0.02) {
      const rain = mix(mix([170, 195, 235], bottom, 0.3), [90, 100, 140], n * 0.5);
      g.fillStyle = rgb(mix(rain, bottom, fade), 0.85 - fade * 0.4);
      const s = this.slant;
      for (let i = 0, N = this.nDrops; i < N; i++) {
        const d = this.drops[i];
        if (d.layer !== layer) continue;
        const x = d.x | 0, y = d.y | 0;
        if (s < 0.25 || d.len < 2) g.fillRect(x, y - d.len, 1, d.len);
        else for (let j = 0; j < d.len; j++) g.fillRect(x - Math.round(j * s), y - j, 1, 1);
      }
      for (const sp of this.splashes) {
        if (sp.layer !== layer) continue;
        const o = sp.life > 0.07 ? 1 : 2;
        g.fillRect(sp.x - o, sp.y - o, 1, 1); g.fillRect(sp.x + o, sp.y - o, 1, 1);
      }
    }
    if (this.p.snow > 0.02) {
      g.fillStyle = rgb(mix(mix([248, 250, 255], [150, 158, 200], n * 0.6), bottom, fade));
      for (let i = 0, N = this.nFlakes; i < N; i++) {
        const f = this.flakes[i];
        if (f.layer === layer) g.fillRect(f.x | 0, f.y | 0, f.size, f.size);
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
    this.drawBolt(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(235,235,255,${this.flash * 0.45})`;
      g.fillRect(0, 0, this.W, this.H);
    }
  }

  drawBolt(g: CanvasRenderingContext2D) {
    if (this.boltLife > 0) {
      g.fillStyle = '#b9b4ff';
      if (this.boltLife > 0.12) for (const [x, y] of this.bolt) if ((x + y) & 1) { g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); }
      g.fillStyle = '#fffbe8';
      for (const [x, y] of this.bolt) g.fillRect(x, y, 1, 1);
    }
  }
}
