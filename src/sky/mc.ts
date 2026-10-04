// Minecraft easter eggs: creepers that blow craters in the hill, and zombies and
// skeletons that wander at night and burn at sunrise.
import { type RGB, NIGHT, Pixels, clamp, disc, dither } from './palette';
import { CREEPER, CREEPER_PAL, SKELETON, SKELETON_PAL, ZOMBIE, ZOMBIE_PAL, drawSprite } from './sprites';
import type { Land } from './land';
import { blip, noise, toast } from '../scripts/clicky';
import type { IconName } from '../data/icons';

export type MobKind = 'creeper' | 'zombie' | 'skeleton';
type Mob = { kind: MobKind; x: number; dir: 1 | -1; speed: number; state: 'walk' | 'hiss' | 'burn' | 'gone'; t0: number; hits: number; hurtUntil: number };
type Bit = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };

const MOBS = { creeper: [CREEPER, CREEPER_PAL], zombie: [ZOMBIE, ZOMBIE_PAL], skeleton: [SKELETON, SKELETON_PAL] } as const;
/** Sprite width and height of each mob. */
const size = (k: MobKind) => ({ w: MOBS[k][0][0].length, h: MOBS[k][0].length });
const WHITE: RGB = [255, 255, 255], RED: RGB = [255, 60, 60];

export class Minecraft {
  mobs: Mob[] = [];
  /** Seconds of screen shake left (the page shakes too, via a CSS class). */
  shake = 0;
  private bits: Bit[] = [];
  private flash = { x: 0, y: 0, a: 0 };
  private seen = new Set<string>();

  constructor(private land: Land) {}

  /** An advancement toast, once per visit for each id. */
  private advance(id: string, name: string, text: string, icon: IconName) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    toast(text, name, icon);
  }

  /** Feet rest on the near hill, under the middle of the sprite. */
  private top(m: Mob) {
    const { w, h } = size(m.kind);
    return this.land.hills[2][clamp(Math.round(m.x + w / 2), 0, this.land.W - 1)] - h + 1;
  }
  private blocked(x: number, w: number) { return x < 2 || x > this.land.W - w - 2 || this.land.reserved(x) || this.land.reserved(x + w); }

  /** Centre of a mob in screen pixels (for tests). */
  center(m: Mob, scale: number) {
    const { w, h } = size(m.kind);
    return { x: (m.x + w / 2) * scale, y: (this.top(m) + h / 2) * scale };
  }

  spawn(kind: MobKind) {
    const { w } = size(kind);
    for (let i = 0; i < 30; i++) {
      const x = this.land.W * (0.05 + Math.random() * 0.9);
      if (this.blocked(x, w)) continue;
      this.mobs.push({ kind, x, dir: Math.random() < 0.5 ? 1 : -1, speed: kind === 'creeper' ? 1.5 : 2.2, state: 'walk', t0: 0, hits: 0, hurtUntil: 0 });
      return;
    }
  }

  // ---------- simulation ----------
  update(dt: number, t: number, n: number) {
    for (const m of this.mobs) {
      if (m.state === 'walk') {
        const nx = m.x + m.dir * m.speed * dt;
        if (this.blocked(nx, size(m.kind).w)) m.dir = -m.dir as 1 | -1; else m.x = nx;
        if (Math.random() < dt / 8) m.dir = -m.dir as 1 | -1; // wander
        if (m.kind !== 'creeper' && n < 0.45) { m.state = 'burn'; m.t0 = t; } // the sun is up
      } else if (m.state === 'hiss' && t - m.t0 > 1.5) this.explode(m);
      else if (m.state === 'burn' && t - m.t0 > 2.2) {
        this.puff(m, 14);
        m.state = 'gone';
        this.advance('burn', 'Sunrise', 'the undead burned away at dawn.', 'sun');
      }
    }
    this.mobs = this.mobs.filter((m) => m.state !== 'gone');

    for (const b of this.bits) { b.vy += 40 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.98; b.life -= dt * 0.9; }
    this.bits = this.bits.filter((b) => b.life > 0 && b.y < this.land.H + 4);
    this.flash.a = Math.max(0, this.flash.a - dt * 3);
    this.shake = Math.max(0, this.shake - dt);
  }

  private explode(m: Mob) {
    const { w, h } = size(m.kind), cx = m.x + w / 2, cy = this.top(m) + h / 2;
    m.state = 'gone';
    this.land.crater(2, cx, 10, 5);
    this.burst(cx, cy, 80, ['#e8e8e8', '#9a9a9a', '#5e5e5e', '#8a5a34', '#5fbf4f', '#ffd84a'], 55);
    this.flash = { x: cx, y: cy, a: 1 };
    this.shake = 0.6;
    noise({ dur: 1.6, freq: 260, gain: 0.55 });
    noise({ dur: 0.45, freq: 1400, type: 'bandpass', gain: 0.16 });
    // anything standing nearby goes too
    for (const o of this.mobs) if (o !== m && o.state !== 'gone' && Math.abs(o.x - m.x) < 14) { this.puff(o, 10); o.state = 'gone'; }
    this.advance('creeper', 'Ssssss... BOOM', 'you let a creeper get too close.', 'creeper');
  }

  private puff(m: Mob, count: number) {
    const { w, h } = size(m.kind);
    this.burst(m.x + w / 2, this.top(m) + h / 2, count, ['#d8d8d8', '#b0b0b0', '#8a8a8a'], 14);
    noise({ dur: 0.25, freq: 1800, type: 'bandpass', gain: 0.05 });
  }

  private burst(x: number, y: number, count: number, colors: string[], speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life: 0.8 + Math.random() * 0.6, color: colors[i % colors.length], size: Math.random() < 0.3 ? 2 : 1 });
    }
  }

  // ---------- interaction ----------
  /** Pointer down on the sky canvas (sky pixels). Returns true if it hit a mob. */
  pointerDown(x: number, y: number, t: number): boolean {
    for (const m of this.mobs) {
      const { w, h } = size(m.kind), top = this.top(m);
      if (m.state === 'gone' || x < m.x - 2 || x > m.x + w + 2 || y < top - 2 || y > top + h + 1) continue;
      if (m.kind === 'creeper') {
        if (m.state === 'walk') { m.state = 'hiss'; m.t0 = t; noise({ dur: 1.5, freq: 3200, type: 'highpass', gain: 0.07 }); }
      } else if (m.state === 'walk') {
        m.hits++; m.hurtUntil = t + 0.25;
        m.x = clamp(m.x - m.dir * 3, 2, this.land.W - w - 2);
        if (m.kind === 'zombie') { blip(140); blip(110, 0.12); } else { blip(2100); blip(1800, 0.05); blip(2300, 0.1); }
        if (m.hits >= 3) {
          this.puff(m, 16);
          m.state = 'gone';
          this.advance('hunter', 'Monster Hunter', `you defeated a ${m.kind}.`, 'sword');
        }
      }
      return true;
    }
    return false;
  }

  // ---------- drawing ----------
  draw(g: CanvasRenderingContext2D, t: number, n: number) {
    for (const m of this.mobs) {
      const [sprite, pal] = MOBS[m.kind];
      // a hissing creeper flashes white, faster and faster
      const hissing = m.state === 'hiss' && Math.floor((t - m.t0) * (6 + (t - m.t0) * 6)) % 2 === 0;
      const hurt = t < m.hurtUntil;
      drawSprite(g, sprite, pal, Math.round(m.x), this.top(m), {
        tint: NIGHT, amount: n * 0.55, flip: m.kind !== 'creeper' && m.dir < 0, // the creeper faces you
        flash: hissing ? WHITE : hurt ? RED : undefined, flashAmount: hissing ? 0.75 : 0.6,
      });
      if (m.state === 'burn') this.fire(g, m, t);
    }
    const bits = new Pixels();
    for (const b of this.bits) if (dither(b.x | 0, b.y | 0) < b.life * 1.3) bits.add(b.color, b.x | 0, b.y | 0, b.size, b.size);
    bits.flush(g);
    if (this.flash.a > 0) { g.fillStyle = `rgba(255,255,240,${this.flash.a * 0.8})`; disc(g, this.flash.x | 0, this.flash.y | 0, 8); }
  }

  private fire(g: CanvasRenderingContext2D, m: Mob, t: number) {
    const { w, h } = size(m.kind), top = this.top(m), px = new Pixels();
    for (let i = 0; i < 10; i++) {
      const fx = Math.round(m.x) + ((i * 7 + Math.floor(t * 12)) % w), fy = top + ((i * 5 + Math.floor(t * 9)) % h);
      px.add(i % 3 ? '#ff8a2a' : '#ffd84a', fx, fy);
    }
    px.flush(g);
  }

  /** Glowing bits for the bloom layer: the explosion flash and burning mobs. */
  drawBloom(bg: CanvasRenderingContext2D, t: number) {
    if (this.flash.a > 0) { bg.fillStyle = `rgba(255,240,200,${this.flash.a})`; disc(bg, this.flash.x | 0, this.flash.y | 0, 11); }
    for (const m of this.mobs) if (m.state === 'burn') this.fire(bg, m, t);
  }

  get active() { return this.mobs.length > 0 || this.bits.length > 0 || this.flash.a > 0; }
}
