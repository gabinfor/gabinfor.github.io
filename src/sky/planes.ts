// Now and then a plane crosses the sky: silver with a contrail by day; at night a dark
// shape with blinking red/green lights and a white strobe (which glow with bloom).
import { Pixels, dither } from './palette';

type Plane = { x: number; y: number; dir: 1 | -1; trail: [number, number, number][]; emit: number; t0: number };

export class Planes {
  private W = 1; private H = 1;
  private plane: Plane | null = null;
  private next = 20 + Math.random() * 30;

  reset(W: number, H: number) { this.W = W; this.H = H; this.plane = null; }

  update(dt: number, fair: boolean, day: boolean, t: number) {
    if (!this.plane && fair && (this.next -= dt) <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.plane = { x: dir > 0 ? -6 : this.W + 6, y: this.H * (0.06 + Math.random() * 0.22), dir, trail: [], emit: 0, t0: t };
      this.next = 35 + Math.random() * 45;
    }
    const p = this.plane;
    if (!p) return;
    p.x += p.dir * 14 * dt;
    if (day && (p.emit -= dt) <= 0) { p.emit = 0.08; p.trail.push([p.x - p.dir * 3, p.y + 1, 0]); }
    for (const tr of p.trail) tr[2] += dt;
    p.trail = p.trail.filter((tr) => tr[2] < 9);
    if ((p.x < -40 || p.x > this.W + 40) && !p.trail.length) this.plane = null;
  }

  draw(g: CanvasRenderingContext2D, t: number, n: number) {
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

  /** Nav lights for the bloom layer (night only). */
  drawBloom(bg: CanvasRenderingContext2D, t: number, n: number) {
    if (this.plane && n > 0.5) this.lights(bg, t);
  }

  private lights(g: CanvasRenderingContext2D, t: number) {
    const p = this.plane!, x = Math.round(p.x), y = Math.round(p.y), k = t - p.t0;
    if (Math.floor(k * 1.2) % 2 === 0) { g.fillStyle = '#ff3b3b'; g.fillRect(x - p.dir * 2, y, 1, 1); }
    if (Math.floor(k * 1.2 + 1) % 2 === 0) { g.fillStyle = '#3bff6a'; g.fillRect(x + p.dir * 2, y, 1, 1); }
    if (k % 1.3 < 0.1) { g.fillStyle = '#ffffff'; g.fillRect(x, y - 1, 1, 1); }
  }
}
