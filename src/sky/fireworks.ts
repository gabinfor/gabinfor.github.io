import { clamp, dither, disc } from './palette';
import { noise } from '../scripts/clicky';

const COLORS = ['#ff4d4d', '#ffd84a', '#5bd1ff', '#ff7ad9', '#7dff8a', '#ffffff', '#ffa64a', '#b48cff'];
type Kind = 'peony' | 'ring' | 'willow' | 'crackle' | 'heart';

type Rocket = { x: number; y: number; vx: number; vy: number; ty: number; trail: [number, number][]; kind: Kind; color: string };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; flicker: boolean; drag: number; grav: number };

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

export class Fireworks {
  private rockets: Rocket[] = [];
  private sparks: Spark[] = [];
  private flashes: { x: number; y: number; life: number }[] = [];
  private queue: { at: number; x?: number; y?: number }[] = [];
  private clock = 0;

  get active() { return this.rockets.length + this.sparks.length + this.queue.length > 0; }

  /** Launch toward (tx, ty) in sky pixels, or somewhere random. */
  launch(W: number, H: number, ground: Int16Array, tx = W * (0.15 + Math.random() * 0.7), ty = H * (0.12 + Math.random() * 0.3)) {
    const x0 = clamp(Math.round(tx + (Math.random() - 0.5) * 16), 0, W - 1);
    const y0 = ground[x0];
    ty = Math.min(ty, y0 - 12);
    const T = 0.9 + Math.random() * 0.4;
    const kind: Kind = Math.random() < 0.08 ? 'heart' : pick(['peony', 'peony', 'ring', 'willow', 'crackle'] as const);
    this.rockets.push({ x: x0, y: y0, vx: (tx - x0) / T, vy: -(y0 - ty) / T, ty, trail: [], kind, color: pick(COLORS) });
    noise({ dur: 0.6, freq: 900, sweep: 3200, type: 'highpass', gain: 0.025 });
  }

  /** A little show: n rockets over a few seconds. */
  show(n: number) {
    for (let i = 0; i < n; i++) this.queue.push({ at: this.clock + i * (0.25 + Math.random() * 0.35) });
  }

  update(dt: number, W: number, H: number, ground: Int16Array) {
    this.clock += dt;
    this.queue = this.queue.filter((q) => (q.at <= this.clock ? (this.launch(W, H, ground), false) : true));

    for (const r of this.rockets) {
      r.trail.unshift([r.x, r.y]); r.trail.length = Math.min(r.trail.length, 5);
      r.x += r.vx * dt; r.y += r.vy * dt + Math.sin(this.clock * 40) * 0.15;
      if (r.y <= r.ty) this.explode(r);
    }
    this.rockets = this.rockets.filter((r) => r.y > r.ty);

    const k = dt * 60;
    for (const s of this.sparks) {
      s.vx *= Math.pow(s.drag, k); s.vy = s.vy * Math.pow(s.drag, k) + s.grav * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
  }

  private explode(r: Rocket) {
    const add = (vx: number, vy: number, o: Partial<Spark> = {}) => {
      if (this.sparks.length > 1500) return;
      const max = o.max ?? 1.2 + Math.random() * 0.4;
      this.sparks.push({ x: r.x, y: r.y, vx, vy, life: max, max, color: r.color, flicker: false, drag: 0.97, grav: 16, ...o });
    };
    const ring = (n: number, speed: () => number, o?: (i: number) => Partial<Spark>) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.15, v = speed();
        add(Math.cos(a) * v, Math.sin(a) * v, o?.(i));
      }
    };
    switch (r.kind) {
      case 'peony': ring(36, () => 18 + Math.random() * 12); break;
      case 'ring': { const c2 = pick(COLORS); ring(28, () => 26, (i) => ({ color: i % 2 ? c2 : r.color, drag: 0.975 })); break; }
      case 'willow': ring(40, () => 12 + Math.random() * 10, () => ({ color: '#ffcf6a', max: 2.2 + Math.random() * 0.6, drag: 0.955, grav: 22 })); break;
      case 'crackle': ring(30, () => 14 + Math.random() * 16, () => ({ color: pick(COLORS), flicker: true })); break;
      case 'heart':
        for (let i = 0; i < 40; i++) {
          const t = (i / 40) * Math.PI * 2;
          const hx = 16 * Math.sin(t) ** 3, hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          add(hx * 1.5, -hy * 1.5, { color: '#ff7ad9', drag: 0.94, grav: 4, max: 1.6 });
        }
    }
    this.flashes.push({ x: r.x, y: r.y, life: 0.08 });
    noise({ dur: 0.7, freq: 220, gain: 0.14, delay: 0.05 });
    if (r.kind === 'crackle') noise({ dur: 0.9, freq: 3000, type: 'bandpass', q: 3, gain: 0.04, delay: 0.4 });
  }

  draw(g: CanvasRenderingContext2D) {
    for (const r of this.rockets) {
      r.trail.forEach(([x, y], i) => {
        if (dither(x | 0, y | 0) < 1 - i / 5) { g.fillStyle = i < 2 ? '#ffd27a' : '#c8642a'; g.fillRect(x | 0, y | 0, 1, 1); }
      });
      g.fillStyle = '#fff3c4'; g.fillRect(r.x | 0, r.y | 0, 1, 1);
    }
    for (const f of this.flashes) { g.fillStyle = '#ffffff'; disc(g, f.x | 0, f.y | 0, 3, 0.6); }
    for (const s of this.sparks) {
      const a = s.life / s.max, x = s.x | 0, y = s.y | 0;
      if (s.flicker && Math.random() < 0.35) continue;
      if (dither(x, y) >= a * 1.4) continue;
      g.fillStyle = s.color;
      g.fillRect(x, y, 1, 1);
      if (a > 0.6) g.fillRect((s.x - s.vx * 0.04) | 0, (s.y - s.vy * 0.04) | 0, 1, 1);
    }
  }
}
