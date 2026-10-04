// The landscape: two mountain ranges, a lake, three hills and a foreground, each
// with its own detail. Static parts are rendered into cached layer canvases and
// only redrawn when the light, weather or size changes; animated bits (lake
// shimmer, smoke, lights) are drawn on top every frame by the caller.
import { type RGB, NIGHT, Pixels, clamp, dither, hex, mix, rgb, rng } from './palette';
import { FENCE, FENCE_PAL, HOUSE, HOUSE_PAL, HOUSE_WINDOW, drawSprite } from './sprites';

// ---------- noise ----------
const hash = (i: number, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const vnoise = (x: number, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i, s) * (1 - u) + hash(i + 1, s) * u; };
const ridged = (x: number, s = 0) => 1 - Math.abs(vnoise(x, s) * 2 - 1);

// ---------- layer order ----------
export const L_MOUNTAINS = 0, L_LAKE = 1, L_FAR = 2, L_MID = 3, L_NEAR = 4, L_FRONT = 5;
const LAYER_COUNT = 6;
const DEPTH = [0.8, 0.6, 0.55, 0.35, 0.15, 0]; // how much fog swallows each layer

export type LandStyle = { n: number; gloom: number; fog: number; snow: number; top: RGB; bottom: RGB };

const C = {
  back: hex('#8a9cc8'), front: hex('#56688f'), snow: hex('#f2f5ff'), snowShade: hex('#b9c4e4'),
  forest: hex('#2f5a3f'), forestLit: hex('#43775a'),
  far: hex('#7aaa6c'), mid: hex('#5a9a4e'), near: hex('#3f8040'),
  pine: hex('#2d5e3a'), pineLit: hex('#3f7a4a'), pineDark: hex('#1f4630'), trunk: hex('#5b3a22'),
  leaf: hex('#3f8a3f'), leafLit: hex('#6cbf5a'), leafDark: hex('#2a6630'),
  fgPine: hex('#1d4230'), fgPineLit: hex('#2b5a3e'), fgPineDark: hex('#122c1e'), fgGrass: hex('#24502c'),
  dirt: hex('#b8996a'), dirtEdge: hex('#8f7550'),
  rock: hex('#8a8a90'), rockLit: hex('#b4b4bc'), rockDark: hex('#5e5e66'),
  water: hex('#22406a'), metal: hex('#3a3a44'), warm: hex('#ffd45a'),
  villageWall: hex('#e6d6b4'), villageRoof: hex('#a8443a'),
};

type Ctx = CanvasRenderingContext2D;

export class Land {
  W = 1; H = 1;
  back = new Int16Array(1); front = new Int16Array(1);
  hills: Int16Array[] = [];
  /** Highest hill surface per column (rockets launch here, birds stay above). */
  ground = new Int16Array(1);
  /** Top of all terrain, mountains included (used to hide lights behind it). */
  skyline = new Int16Array(1);
  lakeTop = 0;
  /** Lake rows that can ever be seen above the hills (the reflection skips the rest). */
  lakeRows = 0;
  /** Cached silhouettes (terrain below the skyline / below the hills), for cutting out glow. */
  skylinePath = new Path2D(); groundPath = new Path2D();
  house = { x: 0, y: 0 };
  lamp = { x: 0, y: 0 };
  village: { x: number; y: number }[] = [];
  private fence = { x: 0, y: 0 };
  private backF: (x: number) => number = () => 0;
  private frontF: (x: number) => number = () => 0;
  private backShadow = new Int16Array(1); private frontShadow = new Int16Array(1);
  private layers: HTMLCanvasElement[] = [];
  private key = '';
  private trees: { layer: number; kind: 'pine' | 'round' | 'bush'; x: number; h: number; seed: number }[] = [];
  private rocks: { x: number; layer: number }[] = [];
  private patches: { layer: number; x: number; dy: number; rx: number; ry: number }[] = [];
  private tufts: [number, string][] = [];

  layout(W: number, H: number) {
    this.W = W; this.H = H; this.key = '';
    this.layers = Array.from({ length: LAYER_COUNT }, () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; return c;
    });

    this.backF = (x) => H * (0.57 - 0.12 * ridged(x / 70, 1) ** 1.4 - 0.045 * vnoise(x / 23, 2) - 0.012 * vnoise(x / 6, 3));
    this.frontF = (x) => H * (0.635 - 0.085 * ridged(x / 44, 4) - 0.03 * vnoise(x / 15, 5) - 0.01 * vnoise(x / 4.5, 6));
    this.back = Int16Array.from({ length: W }, (_, x) => Math.round(this.backF(x)));
    this.front = Int16Array.from({ length: W }, (_, x) => Math.round(this.frontF(x)));
    // Light comes from the upper left: shadowed where terrain to the left rises above the light ray.
    const shadow = (f: (x: number) => number) => Int16Array.from({ length: W }, (_, x) => {
      let s = Infinity;
      for (let k = 1; k <= 90; k++) s = Math.min(s, f(x - k) + k * 0.6);
      return Math.min(H, Math.floor(s));
    });
    this.backShadow = shadow(this.backF);
    this.frontShadow = shadow(this.frontF);
    this.lakeTop = Math.round(H * 0.655);

    const HILLS = [
      { base: 0.74, amp: 0.05, f: 0.02, s: 11 },
      { base: 0.8, amp: 0.05, f: 0.026, s: 12 },
      { base: 0.885, amp: 0.04, f: 0.032, s: 13 },
    ];
    this.hills = HILLS.map((L) => Int16Array.from({ length: W }, (_, x) =>
      Math.round(H * (L.base - L.amp * (Math.sin(x * L.f + L.s) + 0.5 * Math.sin(x * L.f * 2.6 + L.s * 2) + 0.25 * (vnoise(x / 9, L.s) - 0.5))))));
    this.ground = Int16Array.from({ length: W }, (_, x) => Math.min(...this.hills.map((h) => h[x])));
    this.lakeRows = Math.max(0, ...Array.from(this.ground, (y) => y - this.lakeTop)) + 1;
    this.skyline = Int16Array.from({ length: W }, (_, x) => Math.min(this.back[x], this.front[x], this.ground[x]));
    const silhouette = (ys: Int16Array) => {
      const p = new Path2D();
      p.moveTo(0, H);
      for (let x = 0; x < W; x++) { p.lineTo(x, ys[x]); p.lineTo(x + 1, ys[x]); }
      p.lineTo(W, H); p.closePath();
      return p;
    };
    this.skylinePath = silhouette(this.skyline);
    this.groundPath = silhouette(this.ground);

    const near = this.hills[2], cl = (x: number) => clamp(Math.round(x), 0, W - 1);
    const maxIn = (a: Int16Array, x0: number, w: number) => Math.max(...Array.from({ length: w }, (_, i) => a[cl(x0 + i)]));
    this.house = { x: Math.round(W * 0.78), y: 0 };
    this.house.y = maxIn(near, this.house.x, HOUSE[0].length) - HOUSE.length + 1;
    this.fence = { x: this.house.x + 14, y: 0 };
    this.fence.y = maxIn(near, this.fence.x, FENCE[0].length) - FENCE.length + 1;
    this.lamp = { x: this.house.x - 5, y: near[cl(this.house.x - 5)] };

    // A tiny village where the far hill is most visible above the middle one.
    let best = Math.round(W * 0.3), gap = -1;
    for (let x = Math.round(W * 0.1); x < W * 0.6; x++) {
      const g = this.hills[1][x] - this.hills[0][x];
      if (g > gap) { gap = g; best = x; }
    }
    this.village = gap > 5 ? [-7, 0, 6].map((d) => ({ x: cl(best + d), y: this.hills[0][cl(best + d + 2)] })) : [];

    // Trees, rocks and meadow patches on every hill.
    const r = rng(21);
    const reserved = (x: number) => x > this.house.x - 8 && x < this.fence.x + 12;
    this.trees = [];
    for (let x = 1; x < W; x++) { // far hill: a dotted tree line, denser in patches
      const dense = vnoise(x / 14, 31) > 0.55;
      if (this.village.some((v) => Math.abs(v.x - x) < 6)) continue;
      if (r() < (dense ? 0.7 : 0.12)) this.trees.push({ layer: L_FAR, kind: 'pine', x, h: 3 + Math.floor(r() * 2), seed: r() * 1e4 });
    }
    for (let x = 2; x < W; ) { // middle hill: pine forests and loners
      const dense = vnoise(x / 18, 32) > 0.52;
      this.trees.push({ layer: L_MID, kind: 'pine', x, h: 7 + Math.floor(r() * 5), seed: r() * 1e4 });
      x += dense ? 3 + Math.floor(r() * 2) : 9 + Math.floor(r() * 16);
    }
    for (let x = 4; x < W; ) { // near hill: round trees, bushes and the odd pine
      if (!reserved(x)) {
        const k = r();
        this.trees.push({ layer: L_NEAR, kind: k < 0.45 ? 'bush' : k < 0.8 ? 'round' : 'pine', x, h: k < 0.45 ? 4 : 12 + Math.floor(r() * 6), seed: r() * 1e4 });
      }
      x += 12 + Math.floor(r() * 26);
    }
    this.trees.sort((a, b) => a.layer - b.layer || this.hills[a.layer - L_FAR][cl(a.x)] - this.hills[b.layer - L_FAR][cl(b.x)]);
    this.rocks = Array.from({ length: Math.max(3, Math.round(W / 60)) }, () => ({ x: Math.floor(r() * W), layer: r() < 0.5 ? L_MID : L_NEAR }))
      .filter((k) => !reserved(k.x));
    this.patches = Array.from({ length: Math.round(W / 18) }, () => ({
      layer: L_FAR + Math.floor(r() * 3), x: r() * W, dy: 3 + r() * 12, rx: 6 + r() * 12, ry: 1.5 + r() * 2.5,
    }));
    const flowers = ['#ffffff', '#ffd84a', '#ff9ad5', '#9ad0ff'];
    this.tufts = [];
    for (let x = 0; x < W; x++) if (!reserved(x) && r() < 0.4) this.tufts.push([x, r() < 0.08 ? flowers[Math.floor(r() * 4)] : '']);
  }

  /** Re-render the cached layers if the look has changed enough to notice. */
  render(st: LandStyle) {
    const q = (v: number, k: number) => Math.round(v * k);
    const key = [q(st.n, 40), q(st.gloom, 20), q(st.fog, 20), q(st.snow, 20), st.top.map((v) => v >> 2), st.bottom.map((v) => v >> 2)].join('|');
    if (key === this.key) return;
    this.key = key;
    for (let i = 0; i < LAYER_COUNT; i++) {
      const g = this.layers[i].getContext('2d')!;
      g.clearRect(0, 0, this.W, this.H);
      [this.renderMountains, this.renderLake, this.renderFar, this.renderMid, this.renderNear, this.renderFront][i].call(this, g, st);
    }
  }

  draw(g: Ctx, layer: number) { g.drawImage(this.layers[layer], 0, 0); }

  // ---------- colour helpers ----------
  private shader(st: LandStyle, layer: number) {
    const gray: RGB = [110, 114, 124];
    const fogC = mix(mix(st.bottom, [235, 238, 245], 0.5), [60, 64, 90], st.n * 0.7);
    const depth = DEPTH[layer];
    // Overcast skies desaturate (gray) and darken (storm) the land, night tints it blue.
    return (c: RGB) => mix(mix(mix(mix(c, gray, st.gloom * 0.3), [42, 48, 62], st.gloom * 0.35), NIGHT, st.n * 0.8), fogC, st.fog * depth);
  }
  private snowC(st: LandStyle, shadow = false) {
    return mix(shadow ? C.snowShade : C.snow, [120, 128, 170], st.n * 0.7);
  }

  // ---------- mountains ----------
  private renderMountains(g: Ctx, st: LandStyle) {
    const sh = this.shader(st, L_MOUNTAINS);
    this.range(g, st, this.back, this.backShadow, sh(mix(C.back, st.bottom, 0.5)), 0.49, 7, false);
    this.range(g, st, this.front, this.frontShadow, sh(mix(C.front, st.bottom, 0.25)), 0.55, 9, true);
  }

  private range(g: Ctx, st: LandStyle, ys: Int16Array, shadow: Int16Array, base: RGB, snowAt: number, seed: number, forest: boolean) {
    const { W, H } = this, sh = this.shader(st, L_MOUNTAINS);
    const lit = rgb(mix(base, [255, 255, 255], 0.14)), dark = rgb(mix(base, [18, 22, 56], 0.16));
    const rim = rgb(mix(base, [255, 255, 255], 0.3)), speckL = rgb(mix(base, [18, 22, 56], 0.07)), speckD = rgb(mix(base, [18, 22, 56], 0.24));
    const snow = rgb(sh(C.snow)), snowSh = rgb(sh(C.snowShade));
    const snowBase = H * (snowAt + st.snow * 0.05);
    // Drawn in passes (base, texture, snow); each pass is one batched fill per colour.
    const body = new Pixels(), tex = new Pixels(), cap = new Pixels();
    for (let x = 0; x < W; x++) {
      const y0 = ys[x], s = Math.min(H, shadow[x]);
      if (s > y0) { body.add(rim, x, y0); body.add(lit, x, y0 + 1, 1, s - y0 - 1); body.add(dark, x, s, 1, H - s); }
      else body.add(dark, x, y0, 1, H - y0);
      // rock texture and crevices
      for (let y = y0 + 2; y < Math.min(H, y0 + 40); y++) if (hash(x * 73 + y * 151, seed) < 0.025) tex.add(y < s ? speckL : speckD, x, y);
      if (hash(x, seed + 1) < 0.07 && s > y0 + 4) {
        const len = 3 + Math.floor(hash(x, seed + 2) * 7);
        for (let k = 0; k < len; k++) tex.add(dark, x + (k > len / 2 ? 1 : 0), y0 + 2 + k);
      }
      // jagged snowline; snow on the shadow side is bluer
      const line = snowBase + (vnoise(x / 5, seed + 3) - 0.5) * 6;
      for (let y = y0; y < line + 1; y++) {
        if (y >= line - 1 && dither(x, y) >= 0.5) continue;
        cap.add(y < s ? snow : snowSh, x, y);
      }
    }
    body.flush(g); tex.flush(g); cap.flush(g);
    if (!forest) return;
    // a forest along the foot of the front range: bumpy canopy with spires
    const fBody = rgb(sh(C.forest)), fLit = rgb(sh(C.forestLit));
    const trees = new Pixels(), tops = new Pixels();
    for (let x = 0; x < W; x++) {
      const top = Math.max(ys[x] + 3, Math.round(H * 0.6 + vnoise(x / 3.3, seed + 4) * 3));
      if (top >= this.lakeTop) continue;
      trees.add(fBody, x, top, 1, H - top);
      if (hash(x, seed + 5) < 0.4) trees.add(fBody, x, top - (hash(x, seed + 6) < 0.4 ? 2 : 1), 1, hash(x, seed + 6) < 0.4 ? 2 : 1);
      if (hash(x, seed + 7) < 0.3) tops.add(fLit, x, top);
    }
    trees.flush(g); tops.flush(g);
  }

  // ---------- lake ----------
  private renderLake(g: Ctx, st: LandStyle) {
    const { W, H, lakeTop } = this, sh = this.shader(st, L_LAKE);
    // Just the water; the live reflection of the sky and mountains is mirrored in each frame (see reflect()).
    const water = sh(mix(mix(st.top, st.bottom, 0.55), C.water, 0.4));
    g.fillStyle = rgb(water); g.fillRect(0, lakeTop, W, H - lakeTop);
  }

  /** Tint the mirrored image toward the water colour, with darker ripple rows and a bright shoreline. */
  drawLakeTint(g: Ctx, st: LandStyle) {
    const { W, H, lakeTop } = this, sh = this.shader(st, L_LAKE);
    const water = sh(mix(mix(st.top, st.bottom, 0.55), C.water, 0.4));
    g.fillStyle = rgb(water, 0.35); g.fillRect(0, lakeTop, W, H - lakeTop);
    g.fillStyle = rgb(water, 0.45);
    for (let y = lakeTop + 3; y < H; y += 3) g.fillRect(0, y, W, 1);
    g.fillStyle = rgb(mix(water, [255, 255, 255], 0.25));
    g.fillRect(0, lakeTop, W, 1);
  }

  /** Shimmer and the sun/moon's reflection, drawn every frame between the lake and the far hill. */
  drawLakeFx(g: Ctx, t: number, st: LandStyle, light?: { x: number; c: RGB; a: number }) {
    const { W, H, lakeTop } = this, depth = Math.max(4, Math.round((H - lakeTop) * 0.4));
    const water = mix(mix(st.top, st.bottom, 0.55), C.water, 0.4);
    g.fillStyle = rgb(mix(mix(water, [255, 255, 255], 0.35), NIGHT, st.n * 0.5));
    for (let i = 0, n = Math.round(W / 10); i < n; i++) {
      if (Math.sin(t * 1.7 + i * 2.3) < 0.2) continue;
      const x = Math.round(hash(i, 40) * W + Math.sin(t * 0.4 + i) * 2), y = lakeTop + 2 + Math.floor(hash(i, 41) * depth);
      g.fillRect(x, y, 2 + Math.floor(hash(i, 42) * 3), 1);
    }
    if (light && light.a > 0.1) {
      g.fillStyle = rgb(light.c, 0.75 * light.a);
      for (let j = 1; j < depth; j += 2) {
        const w = Math.max(1, Math.round(5 * (1 - j / depth)));
        g.fillRect(Math.round(light.x - w / 2 + Math.sin(t * 2.5 + j) * 1.2), lakeTop + j, w, 1);
      }
    }
  }

  // ---------- hills ----------
  private hillBase(g: Ctx, st: LandStyle, layer: number, color: RGB, haze: number) {
    const { W, H } = this, ys = this.hills[layer - L_FAR], sh = this.shader(st, layer);
    let col = sh(mix(color, st.bottom, haze));
    col = mix(col, this.snowC(st), st.snow * 0.6); // snowy fields
    // the hill body as one stepped polygon (integer, axis-aligned edges stay crisp)
    const body = new Path2D();
    body.moveTo(0, H);
    for (let x = 0; x < W; x++) { body.lineTo(x, ys[x]); body.lineTo(x + 1, ys[x]); }
    body.lineTo(W, H);
    body.closePath();
    g.fillStyle = rgb(col);
    g.fill(body);
    // meadow patches
    const patches = new Pixels(), patchC = rgb(mix(col, [255, 255, 200], 0.06));
    for (const p of this.patches) {
      if (p.layer !== layer) continue;
      for (let dx = -Math.ceil(p.rx); dx <= p.rx; dx++) {
        const x = Math.round(p.x + dx);
        if (x < 0 || x >= W) continue;
        const half = p.ry * Math.sqrt(Math.max(0, 1 - (dx / p.rx) ** 2)), cy = ys[x] + p.dy;
        const y0 = Math.max(ys[x] + 2, Math.round(cy - half)), y1 = Math.floor(cy + half);
        if (y1 >= y0) patches.add(patchC, x, y0, 1, y1 - y0 + 1);
      }
    }
    patches.flush(g);
    // darker lower slopes, eased in with a few dithered rows
    const lower = new Pixels(), lowerC = rgb(mix(col, [0, 0, 0], 0.1));
    for (let x = 0; x < W; x++) {
      const y1 = ys[x] + 16;
      for (let y = ys[x] + 12; y < y1; y++) if (dither(x, y) < (y - ys[x] - 11) / 5) lower.add(lowerC, x, y);
      lower.add(lowerC, x, y1, 1, H - y1);
    }
    lower.flush(g);
    // rim
    const rim = new Pixels(), rim1 = rgb(mix(col, [255, 255, 255], 0.16)), rim2 = rgb(mix(col, [255, 255, 255], 0.07));
    for (let x = 0; x < W; x++) { rim.add(rim1, x, ys[x]); rim.add(rim2, x, ys[x] + 1); }
    rim.flush(g);
    const depth = st.snow * 3;
    if (depth > 0) {
      const snow = new Pixels(), snowC = rgb(this.snowC(st));
      for (let x = 0; x < W; x++) for (let j = 0; j < Math.ceil(depth); j++) if (dither(x, ys[x] + j) < depth - j) snow.add(snowC, x, ys[x] + j);
      snow.flush(g);
    }
    return { ys, sh, col };
  }

  private renderFar(g: Ctx, st: LandStyle) {
    const { ys, sh } = this.hillBase(g, st, L_FAR, C.far, 0.3);
    this.drawTrees(g, st, L_FAR, sh, ys);
    // the village: tiny houses (windows are lit separately so they can glow)
    const wall = rgb(sh(C.villageWall)), roof = rgb(sh(C.villageRoof)), win = rgb(sh(hex('#6f8fbf')));
    for (const v of this.village) {
      g.fillStyle = roof; g.fillRect(v.x, v.y - 4, 4, 1); g.fillRect(v.x + 1, v.y - 5, 2, 1);
      g.fillStyle = wall; g.fillRect(v.x, v.y - 3, 4, 3);
      g.fillStyle = win; g.fillRect(v.x + 1, v.y - 2, 1, 1);
    }
  }

  private renderMid(g: Ctx, st: LandStyle) {
    const { ys, sh } = this.hillBase(g, st, L_MID, C.mid, 0.1);
    this.drawRocks(g, st, L_MID, sh, ys);
    this.drawTrees(g, st, L_MID, sh, ys);
  }

  private renderNear(g: Ctx, st: LandStyle) {
    const { ys, sh, col } = this.hillBase(g, st, L_NEAR, C.near, 0);
    const { W, H } = this, cl = (x: number) => clamp(Math.round(x), 0, W - 1);
    // a dirt path from the door down out of the picture
    if (st.snow < 0.6) {
      const dx0 = this.house.x + 9.5, dy0 = this.house.y + HOUSE.length;
      const dirt = rgb(sh(C.dirt)), edge = rgb(sh(C.dirtEdge)), path = new Pixels();
      for (let i = 0; i <= 120; i++) {
        const t = i / 120, u = 1 - t;
        const x = u * u * dx0 + 2 * u * t * (dx0 - 4) + t * t * (dx0 - W * 0.12);
        const y = u * u * dy0 + 2 * u * t * (H - 6) + t * t * (H + 2);
        const w = 1 + t * 5, x0 = Math.round(x - w / 2), x1 = Math.round(x + w / 2), py = Math.round(y);
        if (w > 2) { path.add(edge, x0, py); path.add(edge, x1, py); path.add(dirt, x0 + 1, py, x1 - x0 - 1, 1); }
        else path.add(dirt, x0, py, x1 - x0 + 1, 1);
      }
      path.flush(g);
    }
    // grass tufts and flowers
    const tufts = new Pixels(), grass = rgb(sh(hex('#6cbf5a')));
    for (const [x, flower] of this.tufts) {
      if (flower) tufts.add(rgb(sh(hex(flower))), x, ys[x] - 1);
      else if (st.snow < 0.5) tufts.add(grass, x, ys[x] - 1);
    }
    tufts.flush(g);
    this.drawRocks(g, st, L_NEAR, sh, ys);
    this.drawTrees(g, st, L_NEAR, sh, ys);

    const night = st.n > 0.5, tintAmt = clamp(st.n * 0.7 + st.gloom * 0.25);
    const opts = { tint: NIGHT, amount: tintAmt, snow: st.snow };
    drawSprite(g, FENCE, FENCE_PAL, this.fence.x, this.fence.y, opts);
    drawSprite(g, HOUSE, HOUSE_PAL, this.house.x, this.house.y, { ...opts, over: night ? { G: C.warm } : undefined });
    if (night) {
      const { x: wx, y: wy, w: ww, h: wh } = HOUSE_WINDOW, hx = this.house.x, hy = this.house.y;
      g.fillStyle = rgb(mix(mix(hex(HOUSE_PAL.W), NIGHT, tintAmt), C.warm, 0.3));
      g.fillRect(hx + wx - 1, hy + wy - 1, ww + 2, 1); g.fillRect(hx + wx - 1, hy + wy + wh, ww + 2, 1);
      g.fillRect(hx + wx - 1, hy + wy, 1, wh); g.fillRect(hx + wx + ww, hy + wy, 1, wh);
      const gy = hy + HOUSE.length;
      g.fillStyle = rgb(mix(col, C.warm, 0.22)); g.fillRect(hx + 1, gy, 11, 1);
      g.fillStyle = rgb(mix(col, C.warm, 0.1)); g.fillRect(hx + 2, gy + 1, 9, 1);
    }
    // lamp post by the path
    const lx = this.lamp.x, ly = ys[cl(lx)];
    g.fillStyle = rgb(sh(C.metal));
    g.fillRect(lx, ly - 8, 1, 8); g.fillRect(lx, ly - 8, 3, 1); g.fillRect(lx + 2, ly - 8, 1, 2);
    g.fillStyle = night ? rgb(C.warm) : rgb(sh(hex('#c8c8b0')));
    g.fillRect(lx + 2, ly - 6, 1, 1);
    if (night) { // warm pool of light under the lamp
      g.fillStyle = rgb(mix(col, C.warm, 0.2));
      g.fillRect(lx, ly, 6, 1); g.fillRect(lx + 1, ly + 1, 4, 1);
    }
  }

  private renderFront(g: Ctx, st: LandStyle) {
    const { W, H } = this;
    if (W < 160) return; // phones: keep the view open
    const sh = this.shader(st, L_FRONT);
    const cols = { body: rgb(sh(C.fgPine)), lit: rgb(sh(C.fgPineLit)), dark: rgb(sh(C.fgPineDark)), trunk: rgb(sh(hex('#3a2616'))) };
    pine(g, -3, H + 1, Math.round(H * 0.52), cols, st.snow, 3);
    pine(g, 9, H + 1, Math.round(H * 0.34), cols, st.snow, 5);
    pine(g, W - 4, H + 1, Math.round(H * 0.46), cols, st.snow, 4);
    // tall grass along the bottom edge
    const grass = new Pixels(), grassC = rgb(sh(st.snow > 0.5 ? mix(C.fgGrass, C.snow, 0.5) : C.fgGrass));
    for (let x = 0; x < W; x++) {
      const h = Math.floor(hash(x, 50) * 4) + (hash(x, 51) < 0.15 ? 3 : 0);
      if (h > 0) grass.add(grassC, x, H - h, 1, h);
    }
    grass.flush(g);
  }

  // ---------- props ----------
  private drawTrees(g: Ctx, st: LandStyle, layer: number, sh: (c: RGB) => RGB, ys: Int16Array) {
    const pineCols = { body: rgb(sh(C.pine)), lit: rgb(sh(C.pineLit)), dark: rgb(sh(C.pineDark)), trunk: rgb(sh(C.trunk)) };
    const leafCols = { body: rgb(sh(C.leaf)), lit: rgb(sh(C.leafLit)), dark: rgb(sh(C.leafDark)), trunk: rgb(sh(C.trunk)) };
    for (const t of this.trees) {
      if (t.layer !== layer) continue;
      const base = ys[clamp(t.x, 0, this.W - 1)] + 1;
      if (t.kind === 'pine') pine(g, t.x, base, t.h, pineCols, st.snow, t.seed);
      else roundTree(g, t.x, base, t.h, leafCols, st.snow, t.seed, t.kind === 'bush');
    }
  }

  private drawRocks(g: Ctx, st: LandStyle, layer: number, sh: (c: RGB) => RGB, ys: Int16Array) {
    for (const k of this.rocks) {
      if (k.layer !== layer) continue;
      const y = ys[clamp(k.x, 0, this.W - 1)] + 2 + (k.x % 5);
      g.fillStyle = rgb(sh(C.rockDark)); g.fillRect(k.x, y, 4, 2);
      g.fillStyle = rgb(sh(C.rock)); g.fillRect(k.x, y - 1, 3, 2);
      g.fillStyle = rgb(st.snow > 0.3 ? this.snowC(st) : sh(C.rockLit)); g.fillRect(k.x, y - 1, 2, 1);
    }
  }
}

type TreeCols = { body: string; lit: string; dark: string; trunk: string };

/** Procedural pine: sawtooth tiers, lit on the left, snow on exposed branch tips. */
function pine(g: Ctx, cx: number, baseY: number, h: number, cols: TreeCols, snow: number, seed: number) {
  const trunkH = Math.max(1, Math.round(h * 0.12)), crownH = h - trunkH;
  const tiers = Math.max(2, Math.round(crownH / 4)), maxHalf = Math.max(1, Math.round(h * 0.28));
  const px = new Pixels();
  px.add(cols.trunk, cx, baseY - trunkH, h > 24 ? 2 : 1, trunkH);
  let prevHalf = -1;
  for (let y = 0; y < crownH; y++) {
    const t = y / crownH, tierPos = ((y * tiers) / crownH) % 1;
    const wobble = h > 20 ? Math.round((hash(y, seed) - 0.5) * 2) : 0;
    const half = Math.max(0, Math.round(maxHalf * (0.15 + 0.85 * t) * (0.5 + 0.5 * tierPos)) + wobble);
    const py = baseY - trunkH - crownH + y;
    for (let dx = -half; dx <= half; dx++) {
      const exposed = Math.abs(dx) > prevHalf;
      px.add(snow > 0 && exposed && dither(cx + dx, py) < snow * 0.9 ? SNOW
        : dx < -half * 0.3 ? cols.lit : dx > half * 0.35 ? cols.dark : cols.body, cx + dx, py);
    }
    prevHalf = half;
  }
  px.flush(g);
}

const SNOW = 'rgb(236,240,252)';

/** Procedural deciduous tree (or bush): a few overlapping blobs, lit from the upper left. */
function roundTree(g: Ctx, cx: number, baseY: number, h: number, cols: TreeCols, snow: number, seed: number, bush: boolean) {
  const trunkH = bush ? 0 : Math.round(h * 0.35), R = Math.max(2, Math.round(bush ? h * 0.6 : h * 0.33));
  const px = new Pixels();
  if (trunkH) px.add(cols.trunk, cx, baseY - trunkH, h > 14 ? 2 : 1, trunkH);
  const cy = baseY - trunkH - R + 1;
  const blobs: [number, number, number][] = bush
    ? [[0, 0, R], [-R * 0.7, R * 0.3, R * 0.7], [R * 0.7, R * 0.3, R * 0.7]]
    : [[0, 0, R], [-R * 0.65, R * 0.3, R * 0.72], [R * 0.65, R * 0.25, R * 0.75], [0, -R * 0.45, R * 0.72]];
  const inside = (x: number, y: number) => blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 <= br * br + 0.5);
  const ext = Math.ceil(R * 1.5);
  for (let y = -ext; y <= ext; y++) for (let x = -ext; x <= ext; x++) {
    if (!inside(x, y)) continue;
    const pxX = cx + x, pxY = cy + y, d = x + y;
    let c = d < -R * 0.6 ? cols.lit : d > R * 0.5 ? cols.dark : cols.body;
    if (c === cols.body && hash(pxX * 13 + pxY * 7, seed) < 0.12) c = cols.lit; // leafy speckle
    if (snow > 0 && !inside(x, y - 1) && dither(pxX, pxY) < snow * 0.9) c = SNOW;
    px.add(c, pxX, pxY);
  }
  px.flush(g);
}
