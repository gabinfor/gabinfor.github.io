// The pixel sky: a low-res canvas behind the page, synced to the visitor's local
// time, with weather, wildlife and fireworks. See Sky.astro for the controls.
import { type RGB, NIGHT, Pixels, clamp, disc, dither, glow, hex, mix, rgb, rng, skyAt, smooth } from './palette';
import { CAT_SCARED, CLOUD_SHAPES, GLYPHS, HOUSE_CHIMNEY, HOUSE_WINDOW } from './sprites';
import { L_FAR, L_FRONT, L_LAKE, L_MID, L_MOUNTAINS, L_NEAR, Land } from './land';
import { type Weather, WeatherFx, forecast, isWeather } from './weather';
import { Fireworks } from './fireworks';
import { type MobKind, Minecraft } from './mc';
import { Planes } from './planes';
import { MilkyWay } from './milkyway';
import { type CloudLook, cumulus, toRuns } from './clouds';
import { blip, noise, toast } from '../scripts/clicky';
import './eggs';

// Screen pixels per sky pixel: 4, or more on big screens so the sky canvas stays
// around 480x300 at most (every per-frame cost scales with its area).
let S = 4;
const canvas = document.querySelector<HTMLCanvasElement>('.sky canvas.base')!;
const g = canvas.getContext('2d')!;
// Bloom layer: light sources only, blurred by CSS and screen-blended on top. Toggled via html[data-bloom].
const bloomCanvas = document.querySelector<HTMLCanvasElement>('.sky canvas.bloom')!;
const bg = bloomCanvas.getContext('2d')!;
const bloomOn = () => document.documentElement.dataset.bloom !== 'off';
// What's glowing this frame (filled in while drawing the scene).
let lights: { sun?: { x: number; y: number; r: number; c: RGB; vis: number }; moon?: { x: number; y: number; r: number; c: RGB; vis: number; lit: number }; stars: number } = { stars: 0 };
let W = 1, H = 1;

type Star = { x: number; y: number; b: number; tw: boolean; big: boolean; c: string };
type ShapeName = keyof typeof CLOUD_SHAPES;
type Cloud = CloudLook & {
  x: number; y: number; speed: number; th: number; shape?: ShapeName; normal?: CloudLook;
  /** Flat, blocky Minecraft version of this cloud (blocky mode), made on first use. */
  blocky?: CloudLook;
  /** Startled by a click: the cat leaps up, arched, until `until` (wall-clock seconds). */
  react?: { start: number; until: number };
};
// Speech bubbles from the clicked cloud cat.
let bubbles: { text: string; cloud: Cloud; dx: number; until: number }[] = [];
// The little "z"s a sleeping cloud cat breathes out.
let zs: { x: number; y: number; life: number }[] = [];
let nextZ = 0;
type Bird = { x: number; y: number; vx: number; vy: number; ph: number };

let stars: Star[] = [];
let clouds: Cloud[] = [];
const land = new Land();
const planes = new Planes();
const milkyWay = new MilkyWay();
const mc = new Minecraft(land);
/** Blocky Minecraft look (the "minecraft" secret word toggles html[data-mc]). */
const mcMode = () => document.documentElement.dataset.mc === 'on';
// Scratch canvas holding this frame's flipped, squashed reflection (see reflect()).
const refl = document.createElement('canvas');
const rg = refl.getContext('2d')!;
let fireflies: { ax: number; ay: number; ph: number }[] = [];
let birds: Bird[] = [];
let smoke: { x: number; y: number; age: number }[] = [];
let meteors: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
let sun: { x: number; y: number; r: number } | null = null;
let shadesUntil = 0;

const params = new URLSearchParams(location.search);
const weatherParam = params.get('weather');
let manualWeather: Weather | null = isWeather(weatherParam) ? weatherParam : null;
const weather = new WeatherFx(manualWeather ?? forecast());
const fireworks = new Fireworks();

// ---------- layout ----------

function makeCloud(r: () => number, th: number, now: number): Cloud {
  // fair-weather puffs, plus wider, taller ones that only show up when it's cloudy
  const big = th > 0.45;
  const w = big ? 34 + Math.floor(r() * 36) : 18 + Math.floor(r() * 16);
  const h = big ? 13 + Math.floor(r() * 4) : 11 + Math.floor(r() * 3);
  const span = W + 2 * w, speed = big ? 0.3 + r() * 0.5 : 0.5 + r() * 1.0;
  return { ...cumulus(w, h, r() * 1000, big ? 0.35 : 0), x: ((r() * span + now * speed) % span) - w, y: big ? 0.04 + r() * 0.26 : 0.08 + r() * 0.32, speed, th };
}

/** Shapes and blocky clouds: lit top edge, body, shaded underside, on the same 5-tone scale. */
function shadeCloud(grid: Uint8Array, w: number, h: number, baseH: number): CloudLook {
  const px: CloudLook['px'] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!grid[y * w + x]) continue;
    const up = y > 0 && grid[(y - 1) * w + x], down = y < h - 1 && grid[(y + 1) * w + x];
    px.push([x, y, !up ? 0 : !down || y >= h - 1 ? 3 : y >= h - baseH && dither(x, y) < 0.5 ? 3 : 1]);
  }
  return toRuns(w, h, px);
}

function shapeLook(name: ShapeName | 'catScared'): CloudLook {
  const rows = name === 'catScared' ? CAT_SCARED : CLOUD_SHAPES[name], w = rows[0].length, h = rows.length;
  const grid = Uint8Array.from(rows.join(''), (c) => (c === '#' ? 1 : 0));
  return shadeCloud(grid, w, h, 3);
}

/** Turn a cloud into the cat (or back into its normal self). */
function reshape(c: Cloud, name?: ShapeName) {
  if (name) { c.normal ??= { w: c.w, h: c.h, px: c.px, runs: c.runs }; Object.assign(c, shapeLook(name), { shape: name }); }
  else if (c.normal) { Object.assign(c, c.normal, { shape: undefined, normal: undefined }); }
}
const randomShape = (): ShapeName => 'cat';

/** Minecraft-style cloud: a row of 4px blocks with a shorter row on top. */
function blockyLook(w: number): CloudLook {
  const cols = Math.max(3, Math.round(w / 4)), bw = cols * 4, h = 6, grid = new Uint8Array(bw * h);
  const lo = Math.floor(Math.random() * cols * 0.35), hi = Math.max(lo + 1, cols - Math.floor(Math.random() * cols * 0.35));
  for (let y = 0; y < h; y++) for (let x = 0; x < bw; x++) {
    const c = x >> 2;
    if (y >= 3 || (c >= lo && c < hi)) grid[y * bw + x] = 1;
  }
  return shadeCloud(grid, bw, h, 1);
}

/** Square, dithered halo (the blocky sun and moon). */
function squareGlow(cx: number, cy: number, r0: number, r1: number, strength: number) {
  const px = new Pixels(), col = g.fillStyle as string;
  for (let k = r0 + 1; k <= r1; k++) {
    const a = strength * (1 - (k - r0) / (r1 - r0 + 1));
    for (let i = -k; i <= k; i++) for (const [x, y] of [[cx + i, cy - k], [cx + i, cy + k], [cx - k, cy + i], [cx + k, cy + i]]) {
      if (dither(x, y) < a) px.add(col, x, y);
    }
  }
  px.flush(g);
}
let catLooks: [CloudLook, CloudLook] | null = null; // asleep / startled

/** Where a cloud is drawn now, including the startled cat's leap (up and back down in 0.7 s). */
function cloudPos(c: Cloud, t = Date.now() / 1000) {
  let dy = 0;
  if (c.shape === 'cat' && c.react && t < c.react.start + 0.7) dy = -Math.round(Math.sin(((t - c.react.start) / 0.7) * Math.PI) * 7);
  return { x: Math.floor(c.x), y: Math.round(c.y * H) + dy };
}
// Where the cat's head is in its frames (for the bubble and the z's).
const CAT_HEAD = { x: 24, sleepY: 9 };

function pixelText(text: string, x: number, y: number, px: Pixels, color: string) {
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) { x += 2; continue; }
    g.forEach((row, gy) => [...row].forEach((c, gx) => c === '#' && px.add(color, x + gx, y + gy)));
    x += g[0].length + 1;
  }
}

function drawBubbles(t: number, n: number) {
  const px = new Pixels();
  for (const b of bubbles) {
    const w = [...b.text].reduce((a, ch) => a + (GLYPHS[ch]?.[0].length ?? 1) + 1, 0) + 3, h = 9;
    const p = cloudPos(b.cloud, t); // follows its cloud (and its leap)
    const x = Math.round(p.x + b.dx - w / 2), y = p.y - h - 3;
    const edge = n > 0.5 ? '#9aa0c8' : '#30304a';
    px.add(edge, x + 1, y, w - 2, 1); px.add(edge, x + 1, y + h - 1, w - 2, 1);
    px.add(edge, x, y + 1, 1, h - 2); px.add(edge, x + w - 1, y + 1, 1, h - 2);
    px.add('#ffffff', x + 1, y + 1, w - 2, h - 2);
    px.add('#ffffff', x + 3, y + h - 1, 2, 1); px.add(edge, x + 3, y + h, 1, 2); px.add(edge, x + 4, y + h, 1, 1); // tail
    pixelText(b.text, x + 2, y + 2, px, '#1b1b2f');
  }
  for (const z of zs) {
    if (dither(z.x | 0, z.y | 0) >= z.life) continue;
    pixelText('Z', Math.round(z.x), Math.round(z.y), px, n > 0.5 ? 'rgba(200,205,240,0.9)' : 'rgba(255,255,255,0.95)');
  }
  px.flush(g);
  bubbles = bubbles.filter((b) => t < b.until);
}

function layout() {
  S = Math.max(4, Math.ceil(Math.max(innerWidth / 480, innerHeight / 300)));
  const forced = Number(new URLSearchParams(location.search).get('scale'));
  if (new URLSearchParams(location.search).has('perf') && forced >= 1) S = forced; // tuning only
  W = Math.max(1, Math.ceil(innerWidth / S));
  H = Math.max(1, Math.ceil(innerHeight / S));
  for (const c of [canvas, bloomCanvas]) {
    c.width = W; c.height = H;
    c.style.width = `${W * S}px`; c.style.height = `${H * S}px`;
  }

  const r = rng(7), starCols = ['#fffbe8', '#dfe8ff', '#ffe9c4'];
  stars = Array.from({ length: Math.round((W * H) / 200) }, () => ({
    x: Math.floor(r() * W), y: Math.floor(r() * H * 0.65), b: 0.35 + r() * 0.65,
    tw: r() < 0.2, big: r() < 0.04, c: starCols[Math.floor(r() * 3)],
  }));

  const rc = rng(99), N = Math.max(8, Math.round(W / 22)), now = Date.now() / 1000;
  clouds = Array.from({ length: N }, (_, i) => makeCloud(rc, (i / N) * 0.95, now));
  if (Math.random() < 0.1) reshape(clouds[Math.floor(Math.random() * 2)], randomShape()); // lucky visit

  land.layout(W, H);
  planes.reset(W, H);
  milkyWay.reset(W, H);
  refl.width = W; refl.height = Math.max(1, land.lakeRows);
  const rf = rng(3);
  fireflies = Array.from({ length: 14 }, () => {
    const ax = rf() * W;
    return { ax, ay: land.hills[2][clamp(ax | 0, 0, W - 1)] - 3 - rf() * 9, ph: rf() * 6.28 };
  });
  weather.resize(W, H);
  gradKey = '';
}

// ---------- drawing ----------

// The dithered sky gradient is built once per colour change into its own canvas and
// copied each frame with drawImage (a GPU blit) instead of re-uploading pixels.
const gradCanvas = document.createElement('canvas');
let gradKey = '';
function drawGradient(top: RGB, bottom: RGB) {
  const key = `${top}|${bottom}|${W}x${H}`;
  if (key !== gradKey) {
    const N = 12, cols = Array.from({ length: N }, (_, i) => mix(top, bottom, i / (N - 1)));
    const img = g.createImageData(W, H), d = img.data, span = H * 0.8;
    for (let y = 0; y < H; y++) {
      const v = Math.min(1, y / span) * (N - 1), b0 = Math.floor(v), f = v - b0, b1 = Math.min(N - 1, b0 + 1);
      for (let x = 0; x < W; x++) {
        const c = f > dither(x, y) ? cols[b1] : cols[b0], i = (y * W + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    gradCanvas.width = W; gradCanvas.height = H;
    gradCanvas.getContext('2d')!.putImageData(img, 0, 0);
    gradKey = key;
  }
  g.drawImage(gradCanvas, 0, 0);
}

const moonPhase = () => {
  const p = (Date.now() / 864e5 - 10962.76) / 29.530588853; // days since the 2000-01-06 new moon
  return p - Math.floor(p);
};

function drawSun(m: SkyMath, horizon: number, R: number, cover: number, bottom: RGB, t: number) {
  const x = Math.round(W * (0.08 + 0.84 * m.sunP)), y = Math.round(horizon - m.e * H * 0.55);
  sun = { x, y, r: R };
  const vis = 1 - smooth(0.5, 0.95, cover); // thin clouds don't dim it
  if (vis < 0.25) return;
  // Behind cloud the sun fades into the sky colour (solid, not dithered — dithering looks like noise).
  const c = mix(mix(hex('#fff2a8'), hex('#ff8a3d'), 1 - smooth(0, 0.35, m.e)), bottom, 1 - vis);
  lights.sun = { x, y, r: R, c, vis };
  const blocky = mcMode();
  g.fillStyle = rgb(mix(c, bottom, 0.35));
  if (blocky) squareGlow(x, y, R, R + 6, 0.55 * vis); else glow(g, x, y, R, R + 6, 0.55 * vis);
  g.fillStyle = rgb(mix(c, hex('#ff8a3d'), 0.35 * vis));
  if (blocky) g.fillRect(x - R, y - R, 2 * R + 1, 2 * R + 1); else disc(g, x, y, R);
  g.fillStyle = rgb(c);
  if (blocky) g.fillRect(x - R + 1, y - R + 1, 2 * R - 1, 2 * R - 1); else disc(g, x, y, R - 1);
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x - Math.round(R * 0.45), y - Math.round(R * 0.5), 2, 1);
  if (t < shadesUntil) { // easter egg: the sun puts on sunglasses
    const lw = Math.max(2, Math.round(R * 0.6)), lh = Math.max(2, Math.round(R * 0.35)), ly = y - Math.round(R * 0.25);
    const xl = x - Math.round(R * 0.75), xr = x + Math.round(R * 0.15);
    g.fillStyle = '#111';
    g.fillRect(xl, ly, lw, lh);
    g.fillRect(xr, ly, lw, lh);
    g.fillRect(xl + lw, ly, xr - xl - lw, 1); // bridge
    g.fillStyle = '#fff';
    g.fillRect(xl + 1, ly + 1, 1, 1);
    g.fillRect(xr + 1, ly + 1, 1, 1);
  }
}

function drawMoon(m: SkyMath, horizon: number, R: number, cover: number, top: RGB) {
  sun = null;
  const x = Math.round(W * (0.08 + 0.84 * m.moonP)), y = Math.round(horizon + m.e * H * 0.55), r = R - 1;
  const today = new Date(), halloween = today.getMonth() === 9 && today.getDate() === 31;
  const fullLit: RGB = halloween ? hex('#ffb45a') : hex('#f3efd6');
  const p = moonPhase(), k = Math.cos(2 * Math.PI * p), vis = 1 - smooth(0.5, 0.95, cover);
  if (vis < 0.25) return; // hidden behind thick cloud
  const lit = mix(top, fullLit, vis), crater = mix(lit, [120, 110, 90], 0.25);
  const isLit = (dx: number, dy: number) => {
    const w = (mcMode() ? r : Math.sqrt(Math.max(0, r * r - dy * dy))) || 1, nx = dx / w;
    return p < 0.5 ? nx > k : nx < -k;
  };
  lights.moon = { x, y, r, c: lit, vis, lit: (1 - k) / 2 };
  g.fillStyle = rgb(lit);
  if (mcMode()) squareGlow(x, y, r, r + 4, 0.22 * vis * (1 - Math.abs(k) * 0.5));
  else glow(g, x, y, r, r + 4, 0.22 * vis * (1 - Math.abs(k) * 0.5));
  const dark = rgb(mix(top, lit, 0.12)), litS = rgb(lit), craterS = rgb(crater);
  const craters = [[-0.35, -0.3], [0.25, 0.2], [-0.1, 0.45], [0.4, -0.35], [0.05, -0.05]].map(([a, b]) => [Math.round(a * r), Math.round(b * r)]);
  for (let dy = -r; dy <= r; dy++) {
    const half = mcMode() ? r : Math.round(Math.sqrt(r * r - dy * dy));
    for (let dx = -half; dx <= half; dx++) {
      const on = isLit(dx, dy);
      g.fillStyle = !on ? dark : craters.some(([cx, cy]) => cx === dx && cy === dy) ? craterS : litS;
      g.fillRect(x + dx, y + dy, 1, 1);
    }
  }
}

function drawClouds(cover: number, tones: RGB[], bottom: RGB, t: number) {
  for (const c of clouds) {
    // aerial perspective: clouds lower in the sky (farther away) fade toward the horizon haze
    const haze = clamp((c.y - 0.12) * 1.3, 0, 0.42);
    const cols = tones.map((tc) => rgb(mix(tc, bottom, haze)));
    const v = smooth(c.th - 0.06, c.th + 0.06, cover);
    if (v <= 0) continue;
    const { x: x0, y: y0 } = cloudPos(c, t);
    const look: CloudLook = mcMode() && !c.shape ? (c.blocky ??= blockyLook(c.w)) : c;
    if (c.shape === 'cat') { // asleep, or arched and startled for a moment after a click
      catLooks ??= [shapeLook('cat'), shapeLook('catScared')];
      Object.assign(c, catLooks[c.react && t < c.react.until ? 1 : 0]);
    }
    const px = new Pixels(); // one fill per tone; tones within a cloud don't overlap
    if (v >= 1) for (const [x, y, len, tone] of look.runs) px.add(cols[tone], x0 + x, y0 + y, len, 1);
    else for (const [x, y, tone] of look.px) if (dither(x0 + x, y0 + y) < v) px.add(cols[tone], x0 + x, y0 + y);
    px.flush(g);
  }
}

// fireflies on warm, dry nights
function drawFireflies(ctx: CanvasRenderingContext2D, m: SkyMath, t: number) {
  const month = new Date().getMonth();
  if (!(m.n > 0.6 && weather.p.rain < 0.1 && weather.p.snow < 0.1 && month >= 3 && month <= 9)) return;
  ctx.fillStyle = '#d8ff6a';
  for (const f of fireflies) {
    if (Math.sin(t * 2 + f.ph * 3) < 0.3) continue;
    ctx.fillRect(Math.round(f.ax + Math.sin(t * 0.7 + f.ph) * 4), Math.round(f.ay + Math.sin(t * 1.1 + f.ph * 2) * 2), 1, 1);
  }
}

function drawMeteors(ctx: CanvasRenderingContext2D) {
  for (const s of meteors) {
    for (let i = 0; i < 7; i++) {
      const x = Math.round(s.x - s.vx * i * 0.012), y = Math.round(s.y - s.vy * i * 0.012);
      if (dither(x, y) < (1 - i / 7) * Math.min(1, s.life * 2)) { ctx.fillStyle = i ? '#cfd8ff' : '#ffffff'; ctx.fillRect(x, y, 1, 1); }
    }
  }
}

function drawBloom(m: SkyMath, t: number) {
  // Nothing glowing (an overcast day)? Hide the layer so the browser skips blurring it.
  const glowing = lights.sun || lights.moon || lights.stars > 0.3 || fireworks.active || meteors.length || m.n > 0.5 || weather.flash > 0 || mc.active;
  bloomCanvas.style.visibility = glowing ? '' : 'hidden';
  if (!glowing) return;
  bg.clearRect(0, 0, W, H);
  const { sun: s, moon: mo } = lights;
  if (s) { bg.fillStyle = rgb(s.c, 0.5 * s.vis); disc(bg, s.x, s.y, s.r); }
  if (mo) { bg.fillStyle = `rgba(240,236,210,${0.35 * mo.vis * mo.lit})`; disc(bg, mo.x, mo.y, mo.r); }
  if (lights.stars > 0.3) {
    bg.fillStyle = `rgba(255,250,235,${lights.stars})`;
    for (const st of stars) if (st.big) bg.fillRect(st.x, st.y, 1, 1);
  }
  fireworks.draw(bg);
  drawMeteors(bg);
  milkyWay.drawBloom(bg, lights.stars);
  planes.drawBloom(bg, t, m.n);
  // Sky lights are behind the terrain: punch out its silhouette so nothing glows through a mountain.
  bg.globalCompositeOperation = 'destination-out';
  bg.fillStyle = '#000';
  bg.fill(land.skylinePath);
  bg.globalCompositeOperation = 'source-over';
  // Their reflections glow in the lake too; then hide whatever the hills cover.
  bg.globalAlpha = 0.6;
  reflect(bg, bloomCanvas, t);
  bg.globalAlpha = 1;
  bg.globalCompositeOperation = 'destination-out';
  bg.fill(land.groundPath);
  bg.globalCompositeOperation = 'source-over';
  // Lights in front of (or on) the terrain.
  drawFireflies(bg, m, t);
  mc.drawBloom(bg, t);
  if (m.n > 0.5) {
    const { x, y, w, h } = HOUSE_WINDOW;
    bg.fillStyle = '#ffd45a';
    bg.fillRect(land.house.x + x, land.house.y + y, w, h);
    bg.fillRect(land.lamp.x + 2, land.lamp.y - 6, 1, 1);
    villageWindows(bg, t);
  }
  weather.drawBolt(bg);
}

// Village windows on the far hill: lit at night, a few switch off now and then.
function villageWindows(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = '#ffd45a';
  land.village.forEach((v, i) => { if (Math.sin(t * 0.05 + i * 2.1) > -0.6) ctx.fillRect(v.x + 1, v.y - 2, 1, 1); });
}

/**
 * Mirror what's above the waterline into the lake: squashed 4:1 so the narrow strip of
 * visible water shows the mountains and some sky (stars, moon, fireworks), with a ripple.
 */
function reflect(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, t: number) {
  const top = land.lakeTop, rows = land.lakeRows, srcH = Math.min(top, rows * 4);
  if (rows < 2 || srcH < 1) return;
  // 1. One scaled copy: flip the band above the waterline and squash it 4:1 (nearest-neighbour,
  //    so row j of `refl` is source row top-1-4j).
  rg.clearRect(0, 0, W, rows);
  rg.imageSmoothingEnabled = false;
  rg.setTransform(1, 0, 0, -0.25, 0, srcH / 4);
  rg.drawImage(src, 0, top - srcH, W, srcH, 0, 0, W, srcH);
  rg.setTransform(1, 0, 0, 1, 0, 0);
  // 2. Lay it on the water in 2-row strips, each nudged sideways for the ripple.
  for (let j = 1; j < rows; j += 2) {
    const dx = j > 2 ? Math.round(Math.sin(t * 1.6 + j * 0.9)) : 0;
    dst.drawImage(refl, 0, j, W, 2, dx, top + j, W, 2);
  }
}

function drawSmoke(m: SkyMath, bottom: RGB) {
  const smokeC = mix(mix([215, 215, 222], bottom, 0.2), NIGHT, m.n * 0.3);
  for (const p of smoke) {
    g.fillStyle = rgb(smokeC, 0.6 * (1 - p.age / 5));
    disc(g, Math.round(p.x), Math.round(p.y), Math.min(2, Math.floor(p.age * 0.6)));
  }
}

function drawCritters(top: RGB, t: number) {
  g.fillStyle = rgb(mix([40, 40, 60], top, 0.2));
  for (const b of birds) {
    const x = Math.round(b.x), y = Math.round(b.y), up = Math.floor(t * 8 + b.ph) & 1;
    g.fillRect(x, y, 1, 1);
    g.fillRect(x - 1, y - up, 1, 1); g.fillRect(x + 1, y - up, 1, 1);
    if (!up) { g.fillRect(x - 2, y + 1, 1, 1); g.fillRect(x + 2, y + 1, 1, 1); }
  }
  drawMeteors(g);
}

type SkyMath = ReturnType<Window['__skyMath']>;

// ?perf in the URL: per-section frame timings, averaged, in window.__skyPerf (for tuning).
const perfOn = new URLSearchParams(location.search).has('perf');
const perf: Record<string, { total: number; n: number; max: number }> = {};
let perfT = 0;
function mark(name?: string) {
  if (!perfOn) return;
  const now = performance.now();
  if (name) {
    const e = (perf[name] ??= { total: 0, n: 0, max: 0 }), d = now - perfT;
    e.total += d; e.n++; e.max = Math.max(e.max, d);
  }
  perfT = now;
}
if (perfOn) (window as unknown as { __skyPerf: () => unknown }).__skyPerf = () =>
  Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, { avg: +(v.total / v.n).toFixed(3), max: +v.max.toFixed(2) }]));

function draw(h: number, t: number) {
  const m = window.__skyMath(h), wx = weather.p;
  let { top, bottom } = skyAt(h);
  top = mix(top, mix([120, 126, 140], [24, 26, 40], m.n), wx.gloom * 0.75);
  bottom = mix(bottom, mix([170, 174, 184], [40, 42, 58], m.n), wx.gloom * 0.7);
  mark();
  drawGradient(top, bottom);
  mark('gradient');
  lights = { stars: 0 };
  const horizon = Math.round(H * 0.74), R = Math.max(4, Math.round(Math.min(W, H) * 0.05));

  const sa = smooth(0.55, 0.95, m.n) * (1 - wx.cover * 0.9);
  lights.stars = sa;
  const gray = mix([150, 154, 168], [70, 72, 90], clamp((wx.gloom - 0.3) / 0.45));
  const hi = mix(mix(mix([255, 255, 255], bottom, 0.25), gray, wx.gloom * 0.85), [50, 54, 96], m.n * 0.85);
  // five cloud tones (highlight .. base shadow); a low sun warms the highlights
  const lowSun = m.sunP >= 0 && m.sunP <= 1 ? 1 - smooth(0, 0.4, m.e) : 0;
  const cloudTones: RGB[] = [
    mix(mix(hi, [255, 255, 255], 0.6 * (1 - m.n)), [255, 170, 120], lowSun * 0.45),
    mix(mix(hi, [255, 255, 255], 0.15 * (1 - m.n)), [255, 160, 130], lowSun * 0.25),
    mix(hi, top, 0.16),
    mix(hi, top, 0.34),
    mix(mix(hi, top, 0.5), [70, 74, 120], 0.2),
  ];
  milkyWay.draw(g, sa); // dark, clear nights only
  if (sa > 0.02) {
    const px = new Pixels();
    for (const s of stars) {
      const a = sa * s.b * (s.tw ? 0.45 + 0.55 * Math.sin(t * 3 + s.x * 1.7) : 1);
      if (dither(s.x, s.y) >= a * 1.2) continue;
      if (s.big && a > 0.5) { px.add(s.c, s.x - 1, s.y, 3, 1); px.add(s.c, s.x, s.y - 1, 1, 3); }
      else px.add(s.c, s.x, s.y);
    }
    px.flush(g);
  }

  if (m.sunP >= 0 && m.sunP <= 1) drawSun(m, horizon, R, wx.cover, bottom, t);
  else drawMoon(m, horizon, R, wx.cover, top);

  planes.draw(g, t, m.n); // above the low clouds' level, so they can drift in front
  drawClouds(wx.cover, cloudTones, bottom, t);
  drawBubbles(t, m.n);

  fireworks.draw(g);
  drawCritters(top, t);
  mark('sky');

  // Landscape, back to front, with each depth layer's rain/snow drawn right after it.
  const st = { n: m.n, gloom: wx.gloom, fog: wx.fog, snow: weather.snowCover, top, bottom };
  land.render(st);
  mark('landRender');
  land.draw(g, L_MOUNTAINS);
  weather.drawPrecip(g, 0, m.n, bottom);
  land.draw(g, L_LAKE);
  g.globalAlpha = 0.65;
  reflect(g, canvas, t); // reads the rows above the waterline, already drawn this frame
  g.globalAlpha = 1;
  land.drawLakeTint(g, st);
  mark('reflection');
  const lo = lights.sun ?? lights.moon;
  land.drawLakeFx(g, t, st, lo && { x: lo.x, c: lo.c, a: lo.vis * (lights.moon && !lights.sun ? 0.4 + lights.moon.lit * 0.6 : 1) });
  land.draw(g, L_FAR);
  if (m.n > 0.5) villageWindows(g, t);
  weather.drawPrecip(g, 1, m.n, bottom);
  land.draw(g, L_MID);
  weather.drawPrecip(g, 2, m.n, bottom);
  land.draw(g, L_NEAR);
  drawSmoke(m, bottom);
  mc.draw(g, t, m.n);
  weather.drawPrecip(g, 3, m.n, bottom);
  drawFireflies(g, m, t);
  land.draw(g, L_FRONT);
  weather.drawFog(g, m.n, bottom);
  weather.drawBolt(g);
  weather.drawPrecip(g, 4, m.n, bottom); // foreground: in front of everything
  weather.drawFlash(g);
  mark('landAndWeather');
  if (bloomOn()) drawBloom(m, t);
  mark('bloom');
}

// ---------- simulation ----------

let nextFlock = 8, smokeTimer = 0;
function update(dt: number, t: number, m: SkyMath) {
  weather.update(dt, t, [land.front, ...land.hills]);
  fireworks.update(dt, W, H, land.ground);
  const wind = weather.p.wind;
  if ((nextZ -= dt) <= 0) {
    nextZ = 1.6;
    for (const c of clouds) if (c.shape === 'cat' && !(c.react && t < c.react.until) && smooth(c.th - 0.06, c.th + 0.06, weather.p.cover) > 0.5)
      zs.push({ x: c.x + CAT_HEAD.x + 3, y: c.y * H + CAT_HEAD.sleepY - 3, life: 1 });
  }
  for (const z of zs) { z.y -= 3 * dt; z.x += 1.5 * dt; z.life -= dt * 0.45; }
  zs = zs.filter((z) => z.life > 0);
  for (const c of clouds) {
    c.x += c.speed * wind * dt;
    if (c.react && t >= c.react.until) c.react = undefined;
    if (c.x > W + c.w) {
      // Off the edge: the cat goes back to being a cloud, and now and then a normal one comes back as the cat.
      if (c.shape) reshape(c);
      else if (c.th < 0.3 && Math.random() < 0.15) reshape(c, randomShape());
      c.x = -c.w;
    }
  }

  // birds: an occasional flock on fair days
  if ((nextFlock -= dt) <= 0) {
    nextFlock = 25 + Math.random() * 40;
    if (m.n < 0.3 && weather.p.cover < 0.7 && weather.p.rain < 0.1) {
      const dir = Math.random() < 0.5 ? 1 : -1, y0 = H * (0.12 + Math.random() * 0.2);
      for (let k = 0, n = 3 + Math.floor(Math.random() * 3); k < n; k++)
        birds.push({ x: dir > 0 ? -4 - k * 5 : W + 4 + k * 5, y: y0 + Math.abs(k - n / 2) * 3, vx: dir * 10, vy: 0, ph: Math.random() * 2 });
    }
  }
  for (const b of birds) { b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(t * 3 + b.ph) * 0.05; }
  birds = birds.filter((b) => b.x > -30 && b.x < W + 30 && b.y > -10);

  if ((smokeTimer -= dt) <= 0) { smokeTimer = 1.3; smoke.push({ x: land.house.x + HOUSE_CHIMNEY.x, y: land.house.y + HOUSE_CHIMNEY.y, age: 0 }); }
  for (const p of smoke) { p.age += dt; p.y -= 4 * dt; p.x += (wind * 1.2 + Math.sin(p.age * 2) * 0.8) * dt; }
  smoke = smoke.filter((p) => p.age < 5);

  // shooting stars on clear nights
  if (m.n > 0.7 && weather.p.cover < 0.5 && Math.random() < dt / 20) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    meteors.push({ x: Math.random() * W, y: Math.random() * H * 0.3, vx: dir * (50 + Math.random() * 30), vy: 22, life: 0.7 });
  }
  planes.update(dt, weather.p.rain < 0.1 && weather.p.cover < 0.8, m.n < 0.4, t);
  for (const s of meteors) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
  meteors = meteors.filter((s) => s.life > 0);
}

// ---------- time, loop & events ----------

let manualHour: number | null = window.__skyOverride;
let lapse: { start: number; from: number } | null = null;
let lastMinute = -1, last = 0, lastSim = performance.now(), weatherBlock = -1;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

function hourNow(now: number) {
  if (lapse) {
    const k = (now - lapse.start) / 1000; // one sky-hour per second
    if (k < 24) return (lapse.from + k) % 24;
    setLapse(null); // a full day has played; back to real time
  }
  return manualHour ?? window.__skyHour();
}

function announce(h: number) {
  const m = window.__skyMath(h);
  document.documentElement.dataset.phase = m.phase;
  document.documentElement.dataset.weather = weather.name;
  dispatchEvent(new CustomEvent('skychange', { detail: { ...m, h, weather: weather.name } }));
}

let newYearShown = false;
function everyMinute() {
  const d = new Date();
  const block = Math.floor(d.getHours() / 4);
  if (!manualWeather && block !== weatherBlock) { weatherBlock = block; weather.name = forecast(d); }
  // At night, now and then, something wanders the hills.
  const n = window.__skyMath(hourNow(performance.now())).n;
  if (n > 0.6 && mc.mobs.length < 2 && Math.random() < 0.25) {
    mc.spawn((['zombie', 'zombie', 'skeleton', 'creeper'] as const)[Math.floor(Math.random() * 4)]);
  }
  // Happy new year!
  if (d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && !newYearShown) { newYearShown = true; fireworks.show(24); }
}

function tick(now: number) {
  if (now - last >= 83 || last === 0) { // ~12 fps for that low-fi feel
    const dt = Math.min(0.25, (now - lastSim) / 1000);
    last = lastSim = now;
    const h = hourNow(now), t = Date.now() / 1000;
    mark();
    update(dt, t, window.__skyMath(h));
    mc.update(dt, t, window.__skyMath(h).n);
    document.documentElement.classList.toggle('quake', mc.shake > 0);
    mark('update');
    draw(h, t);
    const minute = Math.floor(h * 60);
    if (minute !== lastMinute) { lastMinute = minute; everyMinute(); announce(h); }
  }
  schedule();
}


let raf = 0, timer = 0;
function schedule(immediate = false) {
  cancelAnimationFrame(raf); clearTimeout(timer);
  const busy = lapse || fireworks.active || mc.active;
  if (still && !busy && !immediate) timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), 30_000);
  else raf = requestAnimationFrame(tick);
}
const wake = () => { last = 0; lastSim = performance.now(); schedule(true); };

addEventListener('resize', () => { layout(); wake(); });

// ?perf: window.__skyBench(frames, hoursPerFrame) runs frames synchronously (works even in a
// hidden tab) and returns per-section timings; a non-zero hour step exercises landscape re-renders.
// ?perf: where the shaped clouds are, in screen pixels (for testing their click reactions).
if (perfOn) (window as unknown as { __skyShapes: unknown }).__skyShapes = () =>
  clouds.filter((c) => c.shape).map((c) => ({ shape: c.shape, x: (c.x + c.w / 2) * S, y: (c.y * H + c.h / 2) * S }));
if (perfOn) (window as unknown as { __skyMobs: unknown }).__skyMobs = () =>
  mc.mobs.map((m) => ({ kind: m.kind, state: m.state, ...mc.center(m, S) }));
if (perfOn) (window as unknown as { __skyBench: unknown }).__skyBench = (frames = 60, step = 0) => {
  for (const k in perf) delete perf[k];
  let h = hourNow(performance.now());
  for (let i = 0; i < frames; i++, h = (h + step) % 24) {
    const t = Date.now() / 1000 + i / 12;
    mark(); update(1 / 12, t, window.__skyMath(h)); mc.update(1 / 12, t, window.__skyMath(h).n); mark('update');
    draw(h, t);
  }
  const all = Object.values(perf).reduce((a, v) => a + v.total, 0);
  return { W, H, S, frameAvgMs: +(all / frames).toFixed(2), ...(window as unknown as { __skyPerf: () => object }).__skyPerf() };
};
/** Start/stop the time-lapse and tell the UI (the status button shows it as pressed). */
function setLapse(next: typeof lapse) {
  const was = !!lapse;
  lapse = next;
  if (was !== !!next) dispatchEvent(new CustomEvent('sky:lapse', { detail: !!next }));
}

addEventListener('sky:set', (e) => { manualHour = e.detail; setLapse(null); wake(); });
// Toggle: a second click stops it instead of starting another full day.
addEventListener('sky:timelapse', () => {
  setLapse(lapse ? null : { start: performance.now(), from: hourNow(performance.now()) });
  wake();
});
addEventListener('sky:weather', (e) => {
  manualWeather = e.detail;
  weather.name = e.detail ?? forecast();
  if (e.detail === 'storm') weather.strike(land.hills[0]);
  announce(hourNow(performance.now()));
  wake();
});
addEventListener('sky:fireworks', (e) => { fireworks.show(e.detail); wake(); });
addEventListener('sky:bloom', wake);
addEventListener('mc:spawn', (e) => { mc.spawn((e as CustomEvent<MobKind>).detail); wake(); });

// Summon the cloud cat somewhere in view (the "cat" secret word).
addEventListener('sky:cloud', (e) => {
  const c = clouds.filter((k) => !k.shape).sort((a, b) => a.th - b.th)[0];
  if (!c) return;
  reshape(c, e.detail as ShapeName);
  c.x = W * (0.15 + Math.random() * 0.45);
  wake();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastSim = performance.now(); });

// Clicking the empty sky: fireworks at night, startled birds by day, and the sun has a secret.
let foundFireworks = false;
const spotted = new Set<string>();
addEventListener('pointerdown', (e) => {
  const target = e.target instanceof Element ? e.target : document.body;
  if (target.closest('.window, a, button, input, textarea, select, label, .b88, .toast')) return;
  const x = e.clientX / S, y = e.clientY / S, h = hourNow(performance.now()), m = window.__skyMath(h);
  if (mc.pointerDown(x, y, Date.now() / 1000)) { wake(); return; } // clicked a mob
  const now = Date.now() / 1000;
  const shaped = clouds.find((c) => c.shape && smooth(c.th - 0.06, c.th + 0.06, weather.p.cover) > 0.5
    && x >= c.x && x <= c.x + c.w && y >= c.y * H - 4 && y <= c.y * H + c.h);
  if (shaped) {
    // Startled: it leaps up with its back arched and tail puffed, hisses, then curls back up.
    if (shaped.react && now < shaped.react.until) return; // already spooked
    shaped.react = { start: now, until: now + 1.8 };
    bubbles.push({ text: 'HSS!', cloud: shaped, dx: CAT_HEAD.x, until: now + 1.4 });
    noise({ dur: 0.5, freq: 3600, type: 'highpass', gain: 0.06 });
    blip(700); blip(1400, 0.05);
    if (!spotted.has('cat')) { spotted.add('cat'); toast('you startled the cloud cat. it will forgive you. eventually.', 'Let Sleeping Cats Lie', 'cloud'); }
  } else if (sun && Math.hypot(x - sun.x, y - sun.y) <= sun.r + 3) {
    shadesUntil = Date.now() / 1000 + 8;
    blip(1500); blip(2000, 0.08);
    toast('the sun is too cool for you now.', 'shades on', 'sun');
  } else if (m.n > 0.5) {
    // Always burst above the skyline, or a low click would explode out of sight behind a mountain.
    const top = Math.min(...Array.from({ length: 21 }, (_, i) => land.skyline[clamp((x | 0) + i - 10, 0, W - 1)]));
    fireworks.launch(W, H, land.ground, x, Math.min(y, top - 10));
    if (!foundFireworks) { foundFireworks = true; toast('you lit up the night sky. click again!', 'Fireworks', 'firework'); }
  } else if (y < land.ground[clamp(x | 0, 0, W - 1)]) {
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 18 + Math.random() * 10;
      birds.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ph: Math.random() * 2 });
    }
    blip(2400); blip(2900, 0.06);
    noise({ dur: 0.25, freq: 2500, type: 'bandpass', q: 2, gain: 0.02 });
  }
  wake();
});

layout();
if (Math.random() < 0.08) mc.spawn('creeper'); // a rare visitor
everyMinute();
announce(hourNow(performance.now()));
schedule(true);
