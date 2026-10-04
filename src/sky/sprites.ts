import { type RGB, dither, hex, mix, rgb } from './palette';

// Hand-placed pixel sprites. Each char maps to a palette entry; space = transparent.
// No outline, like the other sprites: the roof is shaded instead, lit from the upper left.
export const HOUSE = [
  '         CC  ',
  '      h  CC  ',
  '     hRr CC  ',
  '    hRRRrCC  ',
  '   hRRRRRr   ',
  '  hRRRRRRRr  ',
  ' hRRRRRRRRRr ',
  'rrrrrrrrrrrrr',
  ' WWWWWWWWWWW ',
  ' WGGGWWWWDDW ',
  ' WGGGWWWWDDW ',
  ' WWWWWWWWDkW ',
  ' wwwwwwwwDDw ',
];
export const HOUSE_PAL = {
  h: '#e2704f', R: '#c0462f', r: '#8a2f22', C: '#8a5a44', W: '#efe2c4',
  w: '#c9b48f', D: '#6b4226', k: '#e8c86a', G: '#6f8fbf',
};
/** Where the window glass and chimney top are, relative to the sprite. */
export const HOUSE_WINDOW = { x: 2, y: 9, w: 3, h: 2 };
export const HOUSE_CHIMNEY = { x: 9.5, y: -1 };

export const FENCE = [
  'f  f  f  f',
  'ffffffffff',
  'f  f  f  f',
  'ffffffffff',
  'f  f  f  f',
];
export const FENCE_PAL = { f: '#8a6a48' };

type Pal = Record<string, string>;
const parsed = new WeakMap<Pal, Record<string, RGB>>();
const parse = (p: Pal) => {
  let r = parsed.get(p);
  if (!r) { r = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, hex(v)])); parsed.set(p, r); }
  return r;
};

export type SpriteOpts = {
  /** Tint every colour toward this one by `amount` (night, gloom). */
  tint?: RGB; amount?: number;
  /** 0..1: settle snow on upward-facing pixels. */
  snow?: number; snowColor?: RGB;
  /** Per-char colour overrides (e.g. a lit window). Not tinted. */
  over?: Record<string, RGB>;
  /** Mirror horizontally (sprites face right). */
  flip?: boolean;
  /** Wash every pixel toward this colour (a creeper's white flash, a hit mob's red). */
  flash?: RGB; flashAmount?: number;
};

export function drawSprite(g: CanvasRenderingContext2D, sprite: readonly string[], pal: Pal, x0: number, y0: number, o: SpriteOpts = {}) {
  const base = parse(pal);
  const cols: Record<string, string> = {};
  for (const k in base) {
    let c = o.tint ? mix(base[k], o.tint, o.amount ?? 0) : base[k];
    if (o.flash) c = mix(c, o.flash, o.flashAmount ?? 0.7);
    cols[k] = rgb(c);
  }
  for (const k in o.over ?? {}) cols[k] = rgb(o.over![k]);
  const snow = o.snow ?? 0, snowC = rgb(o.snowColor ?? [240, 244, 255]);
  for (let y = 0; y < sprite.length; y++) {
    const row = sprite[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ' ') continue;
      const exposed = y === 0 || sprite[y - 1][x] === ' ' || sprite[y - 1][x] === undefined;
      const px = x0 + (o.flip ? row.length - 1 - x : x), py = y0 + y;
      g.fillStyle = snow > 0 && exposed && !(o.over && ch in o.over) && dither(px, py) < snow ? snowC : cols[ch];
      g.fillRect(px, py, 1, 1);
    }
  }
}

// Rare cloud shapes (easter egg). '#' = cloud, shaded like any other cloud.
export const CLOUD_SHAPES: Record<'cat' | 'dog', string[]> = {
  cat: [
    '...#...#..............',
    '...##.##..............',
    '...#####..............',
    '..#######.............',
    '..#######.............',
    '...#####........##....',
    '..#######......##.....',
    '.#########.....##.....',
    '.##########....##.....',
    '############..##......',
    '##############........',
    '##############........',
    '.############.........',
  ],
  dog: [
    '..............##......',
    '.............#####....',
    '#............######...',
    '##..........#########.',
    '.##.........#######...',
    '..#################...',
    '..###############.....',
    '..###############.....',
    '..###############.....',
    '..##..##.....##..##...',
    '..##..##.....##..##...',
    '..##..##.....##..##...',
  ],
};

/** Second frame for the cloud dog's wagging tail (same size as CLOUD_SHAPES.dog). */
export const DOG_WAG = [
  '..............##......',
  '.#...........#####....',
  '.#...........######...',
  '.##.........#########.',
  '.##.........#######...',
  '..#################...',
  '..###############.....',
  '..###############.....',
  '..###############.....',
  '..##..##.....##..##...',
  '..##..##.....##..##...',
  '..##..##.....##..##...',
];

/** A tiny 3x5 pixel font, just the letters the speech bubbles need. */
export const GLYPHS: Record<string, string[]> = {
  M: ['#.#', '###', '###', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  F: ['###', '#..', '##.', '#..', '#..'],
  '!': ['#', '#', '#', '.', '#'],
};

// ---------- Minecraft mobs (drawn facing right; mirrored when walking left) ----------
// Front view, the way everyone pictures it: square head with the face, a tall mottled body, two feet.
export const CREEPER = [
  'GgGGHGgG',
  'GHGgGGGH',
  'GKKGgKKG',
  'gKKGGKKG',
  'GGHKKGgG',
  'GgKKKKGG',
  'GGKKKKHG',
  'HGKGgKGG',
  'GgGHGGgG',
  'GGGgGHGG',
  'HGgGGGgG',
  'GGGGHgGG',
  'gGH..GGg',
  'GGG..GHG',
  'gHG..GgG',
];
export const CREEPER_PAL = { G: '#5fbf4f', g: '#3f9a3a', H: '#8fdc7a', K: '#1b1b1b' };

export const ZOMBIE = [
  '.hhhh.',
  '.hkhk.',
  '.hhhh.',
  '.SSShh',
  '.SSS..',
  '.SSS..',
  '.PPP..',
  '.P.P..',
];
export const ZOMBIE_PAL = { h: '#4f8f3c', k: '#13230f', S: '#2fa3a3', P: '#3b3f9e' };

export const SKELETON = [
  '.wwww.',
  '.kwkw.',
  '.wwww.',
  '..w..b',
  '.wwwwb',
  '..w..b',
  '.w.w..',
  '.w.w..',
];
export const SKELETON_PAL = { w: '#d4d4d4', k: '#2a2a2a', b: '#8a5a2b' };
