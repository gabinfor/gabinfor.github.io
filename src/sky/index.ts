// The pixel sky: a low-res canvas behind the page, synced to the visitor's local
// time, with weather, wildlife and fireworks. See Sky.astro for the controls.
import { type RGB, NIGHT, clamp, disc, dither, glow, hex, mix, rgb, rng, skyAt, smooth } from './palette';
import { HOUSE_CHIMNEY, HOUSE_WINDOW } from './sprites';
import { L_FAR, L_FRONT, L_LAKE, L_MID, L_MOUNTAINS, L_NEAR, Land } from './land';
import { type Weather, WeatherFx, forecast, isWeather } from './weather';
import { Fireworks } from './fireworks';
import { blip, noise, toast } from '../scripts/clicky';
import './eggs';

const S = 4; // screen pixels per sky pixel
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
type Cloud = { x: number; y: number; speed: number; w: number; th: number; px: [number, number, number][]; runs: [number, number, number, number][] };
type Bird = { x: number; y: number; vx: number; vy: number; ph: number };

let stars: Star[] = [];
let clouds: Cloud[] = [];
const land = new Land();
// Scratch copy of the sky + mountains, mirrored into the lake each frame.
const snap = document.createElement('canvas');
const sg = snap.getContext('2d')!;
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

  land.layout(W, H);
  snap.width = W; snap.height = H;
  const rf = rng(3);
  fireflies = Array.from({ length: 14 }, () => {
    const ax = rf() * W;
    return { ax, ay: land.hills[2][clamp(ax | 0, 0, W - 1)] - 3 - rf() * 9, ph: rf() * 6.28 };
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
  lights.sun = { x, y, r: R, c, vis };
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
  lights.moon = { x, y, r, c: lit, vis, lit: (1 - k) / 2 };
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
  // Sky lights are behind the terrain: punch out its silhouette so nothing glows through a mountain.
  bg.globalCompositeOperation = 'destination-out';
  bg.fillStyle = '#000';
  for (let x = 0; x < W; x++) bg.fillRect(x, land.skyline[x], 1, H - land.skyline[x]);
  bg.globalCompositeOperation = 'source-over';
  // Their reflections glow in the lake too; then hide whatever the hills cover.
  bg.globalAlpha = 0.6;
  reflect(bg, bloomCanvas, t);
  bg.globalAlpha = 1;
  bg.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < W; x++) bg.fillRect(x, land.ground[x], 1, H - land.ground[x]);
  bg.globalCompositeOperation = 'source-over';
  // Lights in front of (or on) the terrain.
  drawFireflies(bg, m, t);
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
  const top = land.lakeTop;
  for (let j = 1; top + j < H; j++) {
    const sy = top - 1 - j * 4;
    if (sy < 0) break;
    const dx = j > 2 ? Math.round(Math.sin(t * 1.6 + j * 0.9)) : 0;
    dst.drawImage(src, 0, sy, W, 1, dx, top + j, W, 1);
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

function draw(h: number, t: number) {
  const m = window.__skyMath(h), wx = weather.p;
  let { top, bottom } = skyAt(h);
  top = mix(top, mix([120, 126, 140], [24, 26, 40], m.n), wx.gloom * 0.75);
  bottom = mix(bottom, mix([170, 174, 184], [40, 42, 58], m.n), wx.gloom * 0.7);
  drawGradient(top, bottom);
  lights = { stars: 0 };
  const horizon = Math.round(H * 0.74), R = Math.max(4, Math.round(Math.min(W, H) * 0.05));

  const sa = smooth(0.55, 0.95, m.n) * (1 - wx.cover * 0.9);
  lights.stars = sa;
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

  // Landscape, back to front, with each depth layer's rain/snow drawn right after it.
  const st = { n: m.n, gloom: wx.gloom, fog: wx.fog, snow: weather.snowCover, top, bottom };
  land.render(st);
  land.draw(g, L_MOUNTAINS);
  weather.drawPrecip(g, 0, m.n, bottom);
  sg.clearRect(0, 0, W, H);
  sg.drawImage(canvas, 0, 0);
  land.draw(g, L_LAKE);
  g.globalAlpha = 0.65;
  reflect(g, snap, t);
  g.globalAlpha = 1;
  land.drawLakeTint(g, st);
  const lo = lights.sun ?? lights.moon;
  land.drawLakeFx(g, t, st, lo && { x: lo.x, c: lo.c, a: lo.vis * (lights.moon && !lights.sun ? 0.4 + lights.moon.lit * 0.6 : 1) });
  land.draw(g, L_FAR);
  if (m.n > 0.5) villageWindows(g, t);
  weather.drawPrecip(g, 1, m.n, bottom);
  land.draw(g, L_MID);
  weather.drawPrecip(g, 2, m.n, bottom);
  land.draw(g, L_NEAR);
  drawSmoke(m, bottom);
  weather.drawPrecip(g, 3, m.n, bottom);
  drawFireflies(g, m, t);
  land.draw(g, L_FRONT);
  weather.drawPrecip(g, 4, m.n, bottom); // foreground: in front of everything
  weather.drawFog(g, m.n, bottom);
  weather.drawLightning(g);
  if (bloomOn()) drawBloom(m, t);
}

// ---------- simulation ----------

let nextFlock = 8, smokeTimer = 0;
function update(dt: number, t: number, m: SkyMath) {
  weather.update(dt, t, [land.front, ...land.hills]);
  fireworks.update(dt, W, H, land.ground);
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

  if ((smokeTimer -= dt) <= 0) { smokeTimer = 1.3; smoke.push({ x: land.house.x + HOUSE_CHIMNEY.x, y: land.house.y + HOUSE_CHIMNEY.y, age: 0 }); }
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
  if (e.detail === 'storm') weather.strike(land.hills[0]);
  announce(hourNow(performance.now()));
  wake();
});
addEventListener('sky:fireworks', (e) => { fireworks.show(e.detail); wake(); });
addEventListener('sky:bloom', wake);
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastSim = performance.now(); });

// Clicking the empty sky: fireworks at night, startled birds by day, and the sun has a secret.
let foundFireworks = false;
addEventListener('pointerdown', (e) => {
  const target = e.target instanceof Element ? e.target : document.body;
  if (target.closest('.window, a, button, input, textarea, select, label, .b88, .toast')) return;
  const x = e.clientX / S, y = e.clientY / S, h = hourNow(performance.now()), m = window.__skyMath(h);
  if (sun && Math.hypot(x - sun.x, y - sun.y) <= sun.r + 3) {
    shadesUntil = Date.now() / 1000 + 8;
    blip(1500); blip(2000, 0.08);
    toast('the sun is too cool for you now.', 'shades on');
  } else if (m.n > 0.5) {
    // Always burst above the skyline, or a low click would explode out of sight behind a mountain.
    const top = Math.min(...Array.from({ length: 21 }, (_, i) => land.skyline[clamp((x | 0) + i - 10, 0, W - 1)]));
    fireworks.launch(W, H, land.ground, x, Math.min(y, top - 10));
    if (!foundFireworks) { foundFireworks = true; toast('you lit up the night sky. click again!'); }
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
everyMinute();
announce(hourNow(performance.now()));
schedule(true);
