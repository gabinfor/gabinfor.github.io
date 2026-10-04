// Clicky feedback: tiny square-wave blips, pixel sparkles, and the window buttons.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

let soundOn = store.get('sound') !== 'off';
let ac: AudioContext | undefined;

export function blip(freq = 880) {
  if (!soundOn) return;
  ac ??= new AudioContext();
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq / 2, t + 0.05);
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + 0.08);
}

const COLORS = ['#ffd84a', '#ff5a1f', '#5bd1ff', '#ff7ad9', '#ffffff'];
function sparkle(x: number, y: number) {
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('i');
    p.className = 'spark';
    p.style.cssText = `left:${x - 2}px;top:${y - 2}px;background:${COLORS[i % COLORS.length]}`;
    document.body.append(p);
    const a = (i / 8) * Math.PI * 2 + Math.random() * 0.5, d = 16 + Math.random() * 16;
    p.animate(
      [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 10}px)`, opacity: 0 }],
      { duration: 450, easing: 'steps(6)' },
    ).onfinish = () => p.remove();
  }
}

function syncSoundButton() {
  document.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach((b) => {
    b.setAttribute('aria-pressed', String(soundOn));
    b.textContent = soundOn ? '🔊 sound on' : '🔈 sound off';
  });
}

addEventListener('pointerdown', (e) => {
  const el = (e.target as Element).closest('a, button, summary, input, label');
  if (el) blip(el.matches('a') ? 990 : 780);
  if (!still) sparkle(e.clientX, e.clientY);
});

addEventListener('click', (e) => {
  const el = e.target as Element;
  const win = el.closest<HTMLButtonElement>('[data-win]');
  if (win) {
    const w = win.closest('.window')!;
    if (win.dataset.win === 'min') {
      const collapsed = w.classList.toggle('collapsed');
      win.setAttribute('aria-expanded', String(!collapsed));
    } else {
      // You can't close the internet.
      w.classList.remove('shake'); void (w as HTMLElement).offsetWidth; w.classList.add('shake');
      blip(220);
    }
  }
  if (el.closest('[data-sound]')) {
    soundOn = !soundOn;
    store.set('sound', soundOn ? 'on' : 'off');
    syncSoundButton();
    blip(1200);
  }
  const rnd = el.closest<HTMLElement>('[data-random]');
  if (rnd) {
    const urls: string[] = JSON.parse(rnd.dataset.random!);
    location.href = urls[Math.floor(Math.random() * urls.length)];
  }
});

syncSoundButton();
