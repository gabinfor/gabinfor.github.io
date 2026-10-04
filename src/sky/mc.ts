// Minecraft easter eggs: creepers that blow craters in the hill, zombies and skeletons
// that wander at night and burn at sunrise, and mining/placing blocks with a hotbar.
import { type RGB, NIGHT, Pixels, clamp, disc, dither } from './palette';
import { CRACKS, CREEPER, CREEPER_PAL, SKELETON, SKELETON_PAL, ZOMBIE, ZOMBIE_PAL, drawSprite } from './sprites';
import type { Land } from './land';
import { blip, noise, toast } from '../scripts/clicky';
import type { IconName } from '../data/icons';

export type MobKind = 'creeper' | 'zombie' | 'skeleton';
export type Item = 'grass' | 'dirt' | 'stone';
type Mob = { kind: MobKind; x: number; dir: 1 | -1; speed: number; state: 'walk' | 'hiss' | 'burn' | 'gone'; t0: number; hits: number; hurtUntil: number };
type Bit = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };

const MOBS = { creeper: [CREEPER, CREEPER_PAL], zombie: [ZOMBIE, ZOMBIE_PAL], skeleton: [SKELETON, SKELETON_PAL] } as const;
const MAT: Record<Item, string[]> = {
  grass: ['#5aa04a', '#3f8040', '#8a5a34'],
  dirt: ['#8a5a34', '#6e4526', '#9b6b43'],
  stone: ['#8c8c8c', '#6b6b6b', '#a0a0a0'],
};
const WHITE: RGB = [255, 255, 255], RED: RGB = [255, 60, 60];
const MOB_W = 6, MOB_H = 8;

export class Minecraft {
  mobs: Mob[] = [];
  /** Seconds of screen shake left (the page shakes too, via a CSS class). */
  shake = 0;
  inventory: Record<Item, number> = { grass: 0, dirt: 0, stone: 0 };
  selected: Item = 'grass';
  private bits: Bit[] = [];
  private flash = { x: 0, y: 0, a: 0 };
  private mining: { hill: number; x0: number; start: number; dur: number; tick: number } | null = null;
  private seen = new Set<string>();

  constructor(private land: Land) {
    addEventListener('mc:select', (e) => { this.selected = (e as CustomEvent<Item>).detail; this.announce(); });
  }

  /** An advancement toast, once per visit for each id. */
  private advance(id: string, name: string, text: string, icon: IconName) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    toast(text, name, icon);
  }

  private announce() {
    dispatchEvent(new CustomEvent('mc:inventory', { detail: { inventory: { ...this.inventory }, selected: this.selected } }));
  }

  private groundY(x: number) { return this.land.hills[2][clamp(Math.round(x + MOB_W / 2), 0, this.land.W - 1)]; }
  private blocked(x: number) { return x < 2 || x > this.land.W - MOB_W - 2 || this.land.reserved(x) || this.land.reserved(x + MOB_W); }

  spawn(kind: MobKind) {
    for (let i = 0; i < 30; i++) {
      const x = this.land.W * (0.05 + Math.random() * 0.9);
      if (this.blocked(x)) continue;
      this.mobs.push({ kind, x, dir: Math.random() < 0.5 ? 1 : -1, speed: kind === 'creeper' ? 1.5 : 2.2, state: 'walk', t0: 0, hits: 0, hurtUntil: 0 });
      if (kind === 'creeper') noise({ dur: 0.3, freq: 2500, type: 'highpass', gain: 0.02 });
      return;
    }
  }

  // ---------- simulation ----------
  update(dt: number, t: number, n: number) {
    for (const m of this.mobs) {
      if (m.state === 'walk') {
        const nx = m.x + m.dir * m.speed * dt;
        if (this.blocked(nx)) m.dir = -m.dir as 1 | -1; else m.x = nx;
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

    if (this.mining) {
      const mi = this.mining;
      if (t >= mi.tick) { mi.tick = t + 0.25; noise({ dur: 0.05, freq: 900, type: 'bandpass', q: 2, gain: 0.1 }); }
      if (t - mi.start >= mi.dur) this.breakBlock();
    }
  }

  private explode(m: Mob) {
    const cx = m.x + MOB_W / 2, cy = this.groundY(m.x) - 4;
    m.state = 'gone';
    this.land.crater(2, cx, 9, 5);
    this.burst(cx, cy, 70, ['#e8e8e8', '#9a9a9a', '#5e5e5e', '#8a5a34', '#5bb84a', '#ffd84a'], 55);
    this.flash = { x: cx, y: cy, a: 1 };
    this.shake = 0.6;
    noise({ dur: 1.6, freq: 260, gain: 0.55 });
    noise({ dur: 0.45, freq: 1400, type: 'bandpass', gain: 0.16 });
    // anything standing nearby goes too
    for (const o of this.mobs) if (o !== m && o.state !== 'gone' && Math.abs(o.x - m.x) < 12) { this.puff(o, 10); o.state = 'gone'; }
    this.advance('creeper', 'Ssssss... BOOM', 'you let a creeper get too close.', 'creeper');
  }

  private puff(m: Mob, count: number) {
    this.burst(m.x + MOB_W / 2, this.groundY(m.x) - MOB_H / 2, count, ['#d8d8d8', '#b0b0b0', '#8a8a8a'], 14);
    noise({ dur: 0.25, freq: 1800, type: 'bandpass', gain: 0.05 });
  }

  private burst(x: number, y: number, count: number, colors: string[], speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life: 0.8 + Math.random() * 0.6, color: colors[i % colors.length], size: Math.random() < 0.3 ? 2 : 1 });
    }
  }

  // ---------- interaction ----------
  /** Pointer down on the sky canvas (sky pixels). Returns true if a mob or the terrain took it. */
  pointerDown(x: number, y: number, t: number, button: number): boolean {
    for (const m of this.mobs) {
      const top = this.groundY(m.x) - MOB_H + 1;
      if (m.state === 'gone' || x < m.x - 2 || x > m.x + MOB_W + 2 || y < top - 2 || y > top + MOB_H + 1) continue;
      if (m.kind === 'creeper') {
        if (m.state === 'walk') { m.state = 'hiss'; m.t0 = t; noise({ dur: 1.5, freq: 3200, type: 'highpass', gain: 0.07 }); }
      } else if (m.state === 'walk') {
        m.hits++; m.hurtUntil = t + 0.25;
        m.x = clamp(m.x - m.dir * 3, 2, this.land.W - MOB_W - 2);
        if (m.kind === 'zombie') { blip(140); blip(110, 0.12); } else { blip(2100); blip(1800, 0.05); blip(2300, 0.1); }
        if (m.hits >= 3) {
          this.puff(m, 16);
          m.state = 'gone';
          this.advance('hunter', 'Monster Hunter', `you defeated a ${m.kind}.`, 'sword');
        }
      }
      return true;
    }
    const hill = this.land.hillAt(x, y);
    if (hill < 0) return false;
    const x0 = Math.floor(x / 4) * 4;
    if (this.land.reserved(x0) || this.land.reserved(x0 + 3)) return true; // not under the house
    if (button === 2) { this.place(hill, x0); return true; }
    const depth = this.land.cells.get(`${hill}:${x0}`) ?? 0;
    if (depth >= 6) { this.advance('bedrock', 'Deep Dive', "you hit bedrock. that's as far as it goes.", 'block'); return true; }
    this.mining = { hill, x0, start: t, dur: depth >= 3 ? 1.5 : 0.8, tick: t };
    return true;
  }

  pointerUp() { this.mining = null; }

  private breakBlock() {
    const { hill, x0 } = this.mining!;
    this.mining = null;
    const depth = this.land.cells.get(`${hill}:${x0}`) ?? 0;
    const item: Item = depth === 0 ? 'grass' : depth < 3 ? 'dirt' : 'stone';
    const y = this.land.hills[hill][clamp(x0, 0, this.land.W - 1)];
    this.land.digCell(hill, x0, 4);
    this.burst(x0 + 2, y + 2, 14, MAT[item], 16);
    noise({ dur: 0.15, freq: 600, gain: 0.25 });
    this.inventory[item]++;
    this.selected = item;
    this.announce();
    this.advance('mine', 'Taking Inventory', 'you mined a block. right-click a hill to place it back.', 'pickaxe');
    if (item === 'stone') this.advance('stone', 'Stone Age', 'you dug down to stone.', 'block');
  }

  private place(hill: number, x0: number) {
    const item = this.inventory[this.selected] > 0 ? this.selected : (Object.keys(this.inventory) as Item[]).find((k) => this.inventory[k] > 0);
    if (!item) return;
    const y = this.land.hills[hill][clamp(x0, 0, this.land.W - 1)];
    if (y < this.land.H * 0.45) return; // don't build towers into the sky
    this.land.digCell(hill, x0, -4);
    this.inventory[item]--;
    noise({ dur: 0.08, freq: 500, gain: 0.3 });
    this.announce();
  }

  // ---------- drawing ----------
  draw(g: CanvasRenderingContext2D, t: number, n: number) {
    for (const m of this.mobs) {
      const [sprite, pal] = MOBS[m.kind];
      const top = this.groundY(m.x) - MOB_H + 1;
      const hissing = m.state === 'hiss' && Math.floor((t - m.t0) * (6 + (t - m.t0) * 6)) % 2 === 0;
      const hurt = t < m.hurtUntil;
      drawSprite(g, sprite, pal, Math.round(m.x), top, {
        tint: NIGHT, amount: n * 0.55, flip: m.dir < 0,
        flash: hissing ? WHITE : hurt ? RED : undefined, flashAmount: hissing ? 0.75 : 0.6,
      });
      if (m.state === 'burn') this.fire(g, m, t);
    }
    if (this.mining) {
      const { hill, x0, start, dur } = this.mining, top = this.land.hills[hill][clamp(x0, 0, this.land.W - 1)];
      const stage = clamp(Math.floor(((t - start) / dur) * CRACKS.length) + 1, 1, CRACKS.length);
      const px = new Pixels();
      for (let s = 0; s < stage; s++) for (const [cx, cy] of CRACKS[s]) px.add('rgba(0,0,0,0.65)', x0 + cx, top + cy);
      px.flush(g);
    }
    const bits = new Pixels();
    for (const b of this.bits) if (dither(b.x | 0, b.y | 0) < b.life * 1.3) bits.add(b.color, b.x | 0, b.y | 0, b.size, b.size);
    bits.flush(g);
    if (this.flash.a > 0) { g.fillStyle = `rgba(255,255,240,${this.flash.a * 0.8})`; disc(g, this.flash.x | 0, this.flash.y | 0, 7); }
  }

  private fire(g: CanvasRenderingContext2D, m: Mob, t: number) {
    const top = this.groundY(m.x) - MOB_H + 1, px = new Pixels();
    for (let i = 0; i < 10; i++) {
      const fx = Math.round(m.x) + ((i * 7 + Math.floor(t * 12)) % MOB_W), fy = top + ((i * 5 + Math.floor(t * 9)) % MOB_H);
      px.add(i % 3 ? '#ff8a2a' : '#ffd84a', fx, fy);
    }
    px.flush(g);
  }

  /** Glowing bits for the bloom layer: the explosion flash and burning mobs. */
  drawBloom(bg: CanvasRenderingContext2D, t: number) {
    if (this.flash.a > 0) { bg.fillStyle = `rgba(255,240,200,${this.flash.a})`; disc(bg, this.flash.x | 0, this.flash.y | 0, 10); }
    for (const m of this.mobs) if (m.state === 'burn') this.fire(bg, m, t);
  }

  get active() { return this.mobs.length > 0 || this.bits.length > 0 || this.flash.a > 0 || !!this.mining; }
}

