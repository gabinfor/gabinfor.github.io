// Generates the pixel-art cursors in public/cursors/. Run: node scripts/make-cursors.mjs
// X = black outline, W = white fill, . = transparent. Drawn at 2x; keep each under 32px
// (some platforms ignore larger cursors).
import { writeFileSync } from 'node:fs';

const CURSORS = {
  arrow: [
    'X..........', 'XX.........', 'XWX........', 'XWWX.......', 'XWWWX......', 'XWWWWX.....',
    'XWWWWWX....', 'XWWWWWWX...', 'XWWWWWWWX..', 'XWWWWWWWWX.', 'XWWWWWXXXXX', 'XWWXWWX....',
    'XWX.XWWX...', 'XX..XWWX...', 'X....XWWX..', '.....XXX...',
  ],
  hand: [
    '.....XX.......', '....XWWX......', '....XWWX......', '....XWWX......', '....XWWXXX....',
    '....XWWXWWXXX.', '....XWWXWWXWWX', '.XX.XWWWWWWWWX', 'XWWXXWWWWWWWWX', 'XWWWXWWWWWWWWX',
    '.XWWWWWWWWWWWX', '..XWWWWWWWWWWX', '..XWWWWWWWWWX.', '...XWWWWWWWWX.', '....XWWWWWWX..',
    '....XXXXXXXX..',
  ],
  text: [
    'WWW.WWW', 'WXXWXXW', 'WWWXWWW', '..WXW..', '..WXW..', '..WXW..', '..WXW..', '..WXW..',
    '..WXW..', '..WXW..', '..WXW..', '..WXW..', '..WXW..', 'WWWXWWW', 'WXXWXXW', 'WWW.WWW',
  ],
  cross: [
    '....XXX....', '....XWX....', '....XWX....', '....XWX....', 'XXXXX.XXXXX', 'XWWW...WWWX',
    'XXXXX.XXXXX', '....XWX....', '....XWX....', '....XWX....', '....XXX....',
  ],
};

const COLORS = { X: '#000', W: '#fff' };
for (const [name, rows] of Object.entries(CURSORS)) {
  const w = rows[0].length, h = rows.length, rects = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (COLORS[c]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORS[c]}"/>`);
  }));
  writeFileSync(`public/cursors/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`);
  console.log(name, `${w * 2}x${h * 2}`);
}
