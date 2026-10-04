// The pixel sky: a low-res canvas behind the page, synced to the visitor's local
// time, with weather, wildlife and fireworks. See Sky.astro for the controls.
import { type RGB, NIGHT, clamp, disc, dither, glow, hex, mix, rgb, rng, skyAt, smooth } from './palette';
import {
  FENCE, FENCE_PAL, HOUSE, HOUSE_CHIMNEY, HOUSE_PAL, HOUSE_WINDOW, OAK, OAK_PAL, PINE, PINE_PAL, drawSprite,
} from './sprites';
import { type Weather, WeatherFx, forecast, isWeather } from './weather';
import { Fireworks } from './fireworks';
import { blip, noise, toast } from '../scripts/clicky';
import './eggs';

const S = 4; // screen pixels per sky pixel
const canvas = document.querySelector<HTMLCanvasElement>('.sky canvas')!;
const g = canvas.getContext('2d')!;
let W = 1, H = 1;

type Star = { x: number; y: number; b: number; tw: boolean; big: boolean; c: string };
type Cloud = { x: number; y: number; speed: number; w: number; th: number; px: [number, number, number][]; runs: [number, number, number, number][] };
type Bird = { x: number; y: number; vx: number; vy: number; ph: number };

let stars: Star[] = [];
let clouds: Cloud[] = [];
let mountains = new Int16Array(1);
let mountainShadow = new Int16Array(1); // per column: pixels below this row are in shadow
let hills: Int16Array[] = [];
let ground = new Int16Array(1); // highest surface per column (rockets launch from it, birds stay above it)
let pines: number[] = [];
let tufts: [number, number, string][] = [];
let fireflies: { ax: number; ay: number; ph: number }[] = [];
let house = { x: 0, y: 0 }, oak = { x: 0, y: 0 }, fence = { x: 0, y: 0 };
let birds: Bird[] = [];
let smoke: { x: number; y: number; age: number }[] = [];
let meteors: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
let sun: { x: number; y: number; r: number } | null = null;
let shadesUntil = 0;

const HILLS = [
  { base: 0.7, amp: 0.06, f1: 0.018, f2: 0.047, ph: 1.3, color: hex('#7fb07a'), haze: 0.55 },
  { base: 0.79, amp: 0.05, f1: 0.025, f2: 0.061, ph: 4.1, color: hex('#4f9150'), haze: 0.25 },
  { base: 0.88, amp: 0.04, f1: 0.031, f2: 0.083, ph: 2.2, color: hex('#3a7a3c'), haze: 0 },
];
const tri = (v: number) => 1 - Math.abs((((v % 1) + 1) % 1) * 2 - 1);

const params = new URLSearchParams(location.search);
const weatherParam = params.get('weather');
let manualWeather: Weather | null = isWeather(weatherParam) ? weatherParam : null;
const weather = new WeatherFx(manualWeather ?? forecast());
const fireworks = new Fireworks();

// ---------- layout ----------

function makeCloud(r: () => number, th: number, now: number): Cloud {
  const big = th > 0.45;
  const w = big ? 30 + Math.floor(r() * 34) : 16 + Math.floor(r() * 16);
  const h = big ? 9 : 11, baseH = big ? 4 : 3;
  const grid = new Uint8Array(w * h);
  const set = (x: number, y: number) => { if (x >= 0 && x < w && y >= 0 && y < h) grid[y * w + x] = 1; };
  for (let y = h - baseH; y < h; y++) for (let x = y === h - 1 ? 3 : 2; x < w - (y === h - 1 ? 3 : 2); x++) set(x, y);
  const puffs = big ? 4 + Math.floor(r() * 4) : 2 + Math.floor(r() * 3);
  for (let i = 0; i < puffs; i++) {
    const rad = big ? 2 + Math.floor(r() * 3) : 3 + Math.floor(r() * 3);
    const cx = Math.round(rad + 1 + r() * (w - 2 * rad - 2)), cy = h - baseH + 1 - Math.floor(r() * 2);
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad + 1) set(cx + dx, cy + dy);
  }
  // Three tones: lit top edge, body, shaded underside (dithered into the base).
  const px: Cloud['px'] = [], runs: Cloud['runs'] = [];
  for (let y = 0; y < h; y++) {
    let run: [number, number, number, number] | null = null;
    for (let x = 0; x <= w; x++) {
      let tone = -1;
      if (x < w && grid[y * w + x]) {
        const up = y > 0 && grid[(y - 1) * w + x], down = y < h - 1 && grid[(y + 1) * w + x];
        tone = !up ? 0 : !down || y >= h - 1 ? 2 : y >= h - baseH && dither(x, y) < 0.5 ? 2 : 1;
        px.push([x, y, tone]);
      }
      if (run && run[3] !== tone) { runs.push(run); run = null; }
      if (tone >= 0 && !run) run = [x, y, 0, tone];
      if (run) run[2]++;
    }
  }
  const span = W + 2 * w, speed = big ? 0.3 + r() * 0.5 : 0.5 + r() * 1.0;
  return { x: ((r() * span + now * speed) % span) - w, y: big ? 0.04 + r() * 0.26 : 0.08 + r() * 0.32, speed, w, th, px, runs };
}

function layout() {
  W = Math.max(1, Math.ceil(innerWidth / S));
  H = Math.max(1, Math.ceil(innerHeight / S));
  canvas.width = W; canvas.height = H;
  canvas.style.width = `${W * S}px`; canvas.style.height = `${H * S}px`;

  const r = rng(7), starCols = ['#fffbe8', '#dfe8ff', '#ffe9c4'];
  stars = Array.from({ length: Math.round((W * H) / 200) }, () => ({
    x: Math.floor(r() * W), y: Math.floor(r() * H * 0.65), b: 0.35 + r() * 0.65,
    tw: r() < 0.2, big: r() < 0.04, c: starCols[Math.floor(r() * 3)],
  }));

  const rc = rng(99), N = Math.max(8, Math.round(W / 22)), now = Date.now() / 1000;
  clouds = Array.from({ length: N }, (_, i) => makeCloud(rc, (i / N) * 0.95, now));

  const mh = (x: number) => H * (0.62 - 0.09 * tri(x * 0.009 + 0.3) - 0.045 * tri(x * 0.023 + 1.7) - 0.012 * tri(x * 0.061 + 0.9));
  mountains = Int16Array.from({ length: W }, (_, x) => Math.round(mh(x)));
  // Light comes from the upper left: a pixel is shadowed if terrain to its left rises above the light ray.
  mountainShadow = Int16Array.from({ length: W }, (_, x) => {
    let s = Infinity;
    for (let k = 1; k <= 90; k++) s = Math.min(s, mh(x - k) + k * 0.55);
    return Math.min(H, Math.floor(s));
  });
  hills = HILLS.map((L) => Int16Array.from({ length: W }, (_, x) =>
    Math.round(H * (L.base - (L.amp * (Math.sin(x * L.f1 + L.ph) + 0.5 * Math.sin(x * L.f2 + L.ph * 2))) / 1.5))));
  ground = Int16Array.from({ length: W }, (_, x) => Math.min(...hills.map((h) => h[x])));

  const near = hills[2], maxIn = (a: Int16Array, x0: number, w: number) => Math.max(...Array.from({ length: w }, (_, i) => a[clamp(x0 + i, 0, W - 1)]));
  house = { x: Math.round(W * 0.8), y: 0 };
  house.y = maxIn(near, house.x, HOUSE[0].length) - HOUSE.length + 1;
  oak = { x: Math.round(W * 0.66) - 4, y: 0 };
  oak.y = near[clamp(oak.x + 4, 0, W - 1)] - OAK.length + 2;
  fence = { x: house.x + 14, y: 0 };
  fence.y = maxIn(near, fence.x, FENCE[0].length) - FENCE.length + 1;

  const rp = rng(5);
  pines = [];
  for (let x = 3; x < W - 3; x += 6 + Math.floor(rp() * 14)) pines.push(x);
  const rt = rng(11), flowers = ['#ffffff', '#ffd84a', '#ff9ad5'];
  tufts = [];
  for (let x = 0; x < W; x++) {
    if (x >= house.x - 1 && x <= fence.x + 10) continue;
    if (rt() < 0.35) tufts.push([x, near[x] - 1, rt() < 0.07 ? flowers[Math.floor(rt() * 3)] : '']);
  }
  const rf = rng(3);
  fireflies = Array.from({ length: 14 }, () => {
    const ax = rf() * W;
    return { ax, ay: near[clamp(ax | 0, 0, W - 1)] - 3 - rf() * 9, ph: rf() * 6.28 };
  });
  weather.resize(W, H);
  gradKey = '';
}

// ---------- drawing ----------

let grad: ImageData | null = null, gradKey = '';
function drawGradient(top: RGB, bottom: RGB) {
  const key = `${top}|${bottom}|${W}x${H}`;
  if (key !== gradKey || !grad) {
    const N = 12, cols = Array.from({ length: N }, (_, i) => mix(top, bottom, i / (N - 1)));
    const img = g.createImageData(W, H), d = img.data, span = H * 0.8;
    for (let y = 0; y < H; y++) {
      const v = Math.min(1, y / span) * (N - 1), b0 = Math.floor(v), f = v - b0, b1 = Math.min(N - 1, b0 + 1);
      for (let x = 0; x < W; x++) {
        const c = f > dither(x, y) ? cols[b1] : cols[b0], i = (y * W + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    grad = img; gradKey = key;
  }
  g.putImageData(grad, 0, 0);
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
  g.fillStyle = rgb(mix(c, bottom, 0.35)); glow(g, x, y, R, R + 6, 0.55 * vis);
  g.fillStyle = rgb(mix(c, hex('#ff8a3d'), 0.35 * vis)); disc(g, x, y, R);
  g.fillStyle = rgb(c); disc(g, x, y, R - 1);
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
    const w = Math.sqrt(Math.max(0, r * r - dy * dy)) || 1, nx = dx / w;
    return p < 0.5 ? nx > k : nx < -k;
  };
  g.fillStyle = rgb(lit); glow(g, x, y, r, r + 4, 0.22 * vis * (1 - Math.abs(k) * 0.5));
  const dark = rgb(mix(top, lit, 0.12)), litS = rgb(lit), craterS = rgb(crater);
  const craters = [[-0.35, -0.3], [0.25, 0.2], [-0.1, 0.45], [0.4, -0.35], [0.05, -0.05]].map(([a, b]) => [Math.round(a * r), Math.round(b * r)]);
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    for (let dx = -half; dx <= half; dx++) {
      const on = isLit(dx, dy);
      g.fillStyle = !on ? dark : craters.some(([cx, cy]) => cx === dx && cy === dy) ? craterS : litS;
      g.fillRect(x + dx, y + dy, 1, 1);
    }
  }
}

function drawClouds(cover: number, cols: string[]) {
  for (const c of clouds) {
    const v = smooth(c.th - 0.06, c.th + 0.06, cover);
    if (v <= 0) continue;
    const x0 = Math.floor(c.x), y0 = Math.round(c.y * H);
    if (v >= 1) for (const [x, y, len, tone] of c.runs) { g.fillStyle = cols[tone]; g.fillRect(x0 + x, y0 + y, len, 1); }
    else for (const [x, y, tone] of c.px) if (dither(x0 + x, y0 + y) < v) { g.fillStyle = cols[tone]; g.fillRect(x0 + x, y0 + y, 1, 1); }
  }
}

function drawLand(m: SkyMath, bottom: RGB, gloom: number, t: number) {
  const night = m.n * 0.8, gray: RGB = [110, 114, 124], fog = weather.p.fog;
  const fogC = mix(mix(bottom, [235, 238, 245], 0.5), [60, 64, 90], m.n * 0.7);
  // `depth` = how far away a layer is; fog swallows distant layers first.
  const shade = (c: RGB, depth = 0) => mix(mix(mix(c, gray, gloom * 0.3), NIGHT, night), fogC, fog * depth);
  const snowC = rgb(mix([240, 244, 255], [120, 128, 170], m.n * 0.7));
  const snowDepth = weather.snowCover * 3;

  // mountains: faceted by slope, snow above the snowline
  const mBase = shade(mix(hex('#5d6fa8'), bottom, 0.32), 0.75);
  const mLit = rgb(mix(mBase, [255, 255, 255], 0.14)), mDark = rgb(mix(mBase, [20, 24, 60], 0.14));
  const mRim = rgb(mix(mBase, [255, 255, 255], 0.3));
  const snowLine = H * (0.5 + weather.snowCover * 0.05);
  for (let x = 0; x < W; x++) {
    const y0 = mountains[x], sh = mountainShadow[x];
    g.fillStyle = mDark; g.fillRect(x, y0, 1, H - y0);
    if (sh > y0) {
      g.fillStyle = mLit; g.fillRect(x, y0, 1, sh - y0);
      g.fillStyle = mRim; g.fillRect(x, y0, 1, 1);
    }
    g.fillStyle = snowC;
    for (let y = y0; y < snowLine + 2; y++) if (y < snowLine - 1 || dither(x, y) < 0.5) g.fillRect(x, y, 1, 1);
  }
  weather.drawPrecip(g, 0, m.n, bottom); // weather falling on the mountains

  hills.forEach((ys, i) => {
    const L = HILLS[i], depth = [0.55, 0.35, 0.15][i], col = shade(mix(L.color, bottom, L.haze), depth);
    g.fillStyle = rgb(col);
    for (let x = 0; x < W; x++) g.fillRect(x, ys[x], 1, H - ys[x]);
    // a bright rim with a softer row under it (solid, not dithered — dithering read as a dashed line)
    g.fillStyle = rgb(mix(col, [255, 255, 255], 0.07));
    for (let x = 0; x < W; x++) g.fillRect(x, ys[x] + 1, 1, 1);
    g.fillStyle = rgb(mix(col, [255, 255, 255], 0.16));
    for (let x = 0; x < W; x++) g.fillRect(x, ys[x], 1, 1);
    if (snowDepth > 0) {
      g.fillStyle = snowC;
      for (let x = 0; x < W; x++) for (let j = 0; j < Math.ceil(snowDepth); j++) if (dither(x, ys[x] + j) < snowDepth - j) g.fillRect(x, ys[x] + j, 1, 1);
    }
    const foggy = fog * depth > m.n * 0.7;
    const tint = foggy ? fogC : NIGHT, amount = clamp(foggy ? fog * depth : m.n * 0.7 + gloom * 0.25), snow = weather.snowCover;
    if (i === 1) for (const x of pines) drawSprite(g, PINE, PINE_PAL, x - 2, ys[x] - PINE.length + 2, { tint, amount, snow });
    if (i === 2) {
      g.fillStyle = rgb(shade(hex('#6cbf5a')));
      for (const [x, y, flower] of tufts) {
        if (flower) { g.fillStyle = rgb(shade(hex(flower))); g.fillRect(x, y, 1, 1); g.fillStyle = rgb(shade(hex('#6cbf5a'))); }
        else if (weather.snowCover < 0.5) g.fillRect(x, y, 1, 1);
      }
      drawSprite(g, OAK, OAK_PAL, oak.x, oak.y, { tint, amount, snow });
      drawSprite(g, FENCE, FENCE_PAL, fence.x, fence.y, { tint, amount, snow });
      const lit = m.n > 0.5;
      drawSprite(g, HOUSE, HOUSE_PAL, house.x, house.y, { tint, amount, snow, over: lit ? { G: hex('#ffd45a') } : undefined });
      if (lit) {
        // Warm light: a halo on the wall around the window, and a patch of lit ground by the door.
        const warm = hex('#ffd45a'), { x: wx, y: wy, w: ww, h: wh } = HOUSE_WINDOW, hx = house.x, hy = house.y;
        g.fillStyle = rgb(mix(mix(hex(HOUSE_PAL.W), tint, amount), warm, 0.3));
        g.fillRect(hx + wx - 1, hy + wy - 1, ww + 2, 1);
        g.fillRect(hx + wx - 1, hy + wy + wh, ww + 2, 1);
        g.fillRect(hx + wx - 1, hy + wy, 1, wh);
        g.fillRect(hx + wx + ww, hy + wy, 1, wh);
        const groundY = hy + HOUSE.length;
        g.fillStyle = rgb(mix(col, warm, 0.22)); g.fillRect(hx + 1, groundY, 11, 1);
        g.fillStyle = rgb(mix(col, warm, 0.1)); g.fillRect(hx + 2, groundY + 1, 9, 1);
      }
      // chimney smoke: separate soft puffs that grow and fade
      const smokeC = mix(mix([215, 215, 222], bottom, 0.2), NIGHT, m.n * 0.3);
      for (const p of smoke) {
        g.fillStyle = rgb(smokeC, 0.6 * (1 - p.age / 5));
        disc(g, Math.round(p.x), Math.round(p.y), Math.min(2, Math.floor(p.age * 0.6)));
      }
    }
    weather.drawPrecip(g, i + 1, m.n, bottom); // ...and on this hill, hidden by the nearer ones
  });

  // fireflies on warm, dry nights
  const month = new Date().getMonth();
  if (m.n > 0.6 && weather.p.rain < 0.1 && weather.p.snow < 0.1 && month >= 3 && month <= 9) {
    g.fillStyle = '#d8ff6a';
    for (const f of fireflies) {
      if (Math.sin(t * 2 + f.ph * 3) < 0.3) continue;
      g.fillRect(Math.round(f.ax + Math.sin(t * 0.7 + f.ph) * 4), Math.round(f.ay + Math.sin(t * 1.1 + f.ph * 2) * 2), 1, 1);
    }
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
  for (const s of meteors) {
    for (let i = 0; i < 7; i++) {
      const x = Math.round(s.x - s.vx * i * 0.012), y = Math.round(s.y - s.vy * i * 0.012);
      if (dither(x, y) < (1 - i / 7) * Math.min(1, s.life * 2)) { g.fillStyle = i ? '#cfd8ff' : '#ffffff'; g.fillRect(x, y, 1, 1); }
    }
  }
}

type SkyMath = ReturnType<Window['__skyMath']>;

function draw(h: number, t: number) {
  const m = window.__skyMath(h), wx = weather.p;
  let { top, bottom } = skyAt(h);
  top = mix(top, mix([120, 126, 140], [24, 26, 40], m.n), wx.gloom * 0.75);
  bottom = mix(bottom, mix([170, 174, 184], [40, 42, 58], m.n), wx.gloom * 0.7);
  drawGradient(top, bottom);
  const horizon = Math.round(H * 0.74), R = Math.max(4, Math.round(Math.min(W, H) * 0.05));

  const sa = smooth(0.55, 0.95, m.n) * (1 - wx.cover * 0.9);
  if (sa > 0.02) for (const s of stars) {
    const a = sa * s.b * (s.tw ? 0.45 + 0.55 * Math.sin(t * 3 + s.x * 1.7) : 1);
    if (dither(s.x, s.y) >= a * 1.2) continue;
    g.fillStyle = s.c;
    g.fillRect(s.x, s.y, 1, 1);
    if (s.big && a > 0.5) { g.fillRect(s.x - 1, s.y, 1, 1); g.fillRect(s.x + 1, s.y, 1, 1); g.fillRect(s.x, s.y - 1, 1, 1); g.fillRect(s.x, s.y + 1, 1, 1); }
  }

  if (m.sunP >= 0 && m.sunP <= 1) drawSun(m, horizon, R, wx.cover, bottom, t);
  else drawMoon(m, horizon, R, wx.cover, top);

  const gray = mix([150, 154, 168], [70, 72, 90], clamp((wx.gloom - 0.3) / 0.45));
  const hi = mix(mix(mix([255, 255, 255], bottom, 0.25), gray, wx.gloom * 0.85), [50, 54, 96], m.n * 0.85);
  drawClouds(wx.cover, [rgb(hi), rgb(mix(hi, top, 0.18)), rgb(mix(hi, top, 0.42))]);

  fireworks.draw(g);
  drawCritters(top, t);
  drawLand(m, bottom, wx.gloom, t);
  weather.drawPrecip(g, 4, m.n, bottom); // foreground: in front of everything
  weather.drawFog(g, m.n, bottom);
  weather.drawLightning(g);
}

// ---------- simulation ----------

let nextFlock = 8, smokeTimer = 0;
function update(dt: number, t: number, m: SkyMath) {
  weather.update(dt, t, [mountains, ...hills]);
  fireworks.update(dt, W, H, ground);
  const wind = weather.p.wind;
  for (const c of clouds) { c.x += c.speed * wind * dt; if (c.x > W + c.w) c.x -= W + 2 * c.w; }

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

  if ((smokeTimer -= dt) <= 0) { smokeTimer = 1.3; smoke.push({ x: house.x + HOUSE_CHIMNEY.x, y: house.y + HOUSE_CHIMNEY.y, age: 0 }); }
  for (const p of smoke) { p.age += dt; p.y -= 4 * dt; p.x += (wind * 1.2 + Math.sin(p.age * 2) * 0.8) * dt; }
  smoke = smoke.filter((p) => p.age < 5);

  // shooting stars on clear nights
  if (m.n > 0.7 && weather.p.cover < 0.5 && Math.random() < dt / 20) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    meteors.push({ x: Math.random() * W, y: Math.random() * H * 0.3, vx: dir * (50 + Math.random() * 30), vy: 22, life: 0.7 });
  }
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
    lapse = null;
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
  // Happy new year!
  if (d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && !newYearShown) { newYearShown = true; fireworks.show(24); }
}

function tick(now: number) {
  if (now - last >= 83 || last === 0) { // ~12 fps for that low-fi feel
    const dt = Math.min(0.25, (now - lastSim) / 1000);
    last = lastSim = now;
    const h = hourNow(now), t = Date.now() / 1000;
    update(dt, t, window.__skyMath(h));
    draw(h, t);
    const minute = Math.floor(h * 60);
    if (minute !== lastMinute) { lastMinute = minute; everyMinute(); announce(h); }
  }
  schedule();
}

let raf = 0, timer = 0;
function schedule(immediate = false) {
  cancelAnimationFrame(raf); clearTimeout(timer);
  const busy = lapse || fireworks.active;
  if (still && !busy && !immediate) timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), 30_000);
  else raf = requestAnimationFrame(tick);
}
const wake = () => { last = 0; lastSim = performance.now(); schedule(true); };

addEventListener('resize', () => { layout(); wake(); });
addEventListener('sky:set', (e) => { manualHour = e.detail; lapse = null; wake(); });
addEventListener('sky:timelapse', () => { lapse = { start: performance.now(), from: hourNow(performance.now()) }; wake(); });
addEventListener('sky:weather', (e) => {
  manualWeather = e.detail;
  weather.name = e.detail ?? forecast();
  if (e.detail === 'storm') weather.strike(hills[0]);
  announce(hourNow(performance.now()));
  wake();
});
addEventListener('sky:fireworks', (e) => { fireworks.show(e.detail); wake(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastSim = performance.now(); });

// Clicking the empty sky: fireworks at night, startled birds by day, and the sun has a secret.
let foundFireworks = false;
addEventListener('pointerdown', (e) => {
  if ((e.target as Element).closest('.window, a, button, input, textarea, select, label, .b88, .toast')) return;
  const x = e.clientX / S, y = e.clientY / S, h = hourNow(performance.now()), m = window.__skyMath(h);
  if (sun && Math.hypot(x - sun.x, y - sun.y) <= sun.r + 3) {
    shadesUntil = Date.now() / 1000 + 8;
    blip(1500); blip(2000, 0.08);
    toast('the sun is too cool for you now.', 'shades on');
  } else if (m.n > 0.5) {
    fireworks.launch(W, H, ground, x, y);
    if (!foundFireworks) { foundFireworks = true; toast('you lit up the night sky. click again!'); }
  } else if (y < ground[clamp(x | 0, 0, W - 1)]) {
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
everyMinute();
announce(hourNow(performance.now()));
schedule(true);
