// Clicky feedback: tiny chiptune blips, noise effects, pixel sparkles, toasts, and the window buttons.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

let soundOn = store.get('sound') !== 'off';
let ac: AudioContext | undefined;

/** An AudioContext, but only once the visitor has interacted (browsers block it before). */
function audio() {
  if (!soundOn) return null;
  if (!ac && !navigator.userActivation?.hasBeenActive) return null;
  ac ??= new AudioContext();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function blip(freq = 880, delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq / 2, t + 0.05);
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + 0.08);
}

/** Filtered white noise: thunder, fireworks, whooshes. */
export function noise({ dur = 0.5, freq = 800, sweep, type = 'lowpass', q = 0.7, gain = 0.1, delay = 0 }:
  { dur?: number; freq?: number; sweep?: number; type?: BiquadFilterType; q?: number; gain?: number; delay?: number }) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t); src.stop(t + dur);
}

/** A little "achievement unlocked" window in the corner. */
export function toast(text: string, title = 'achievement unlocked!') {
  const el = document.createElement('div');
  el.className = 'toast window';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="titlebar"><span class="tb-title"></span></div><div class="win-body"></div>`;
  el.querySelector('.tb-title')!.textContent = `★ ${title}`;
  el.querySelector('.win-body')!.textContent = text;
  document.body.append(el);
  [660, 880, 1320].forEach((f, i) => blip(f, i * 0.07));
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
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
  document.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach((b) => b.setAttribute('aria-pressed', String(soundOn)));
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
    if (urls.length) location.href = urls[Math.floor(Math.random() * urls.length)];
  }
});

syncSoundButton();
