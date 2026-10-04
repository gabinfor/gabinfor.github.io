// Secrets. Spoilers below!
//  - Konami code (↑↑↓↓←→←→BA): fireworks finale
//  - Type (outside any text box): rain, snow, storm, fog, cloudy, clear, forecast, boom, cat, dog, night, day, now
//  - Click the sun: shades. Click the night sky: fireworks. Click the day sky: birds.
import { toast } from '../scripts/clicky';
import type { Weather } from './forecast';

const fire = (type: string, detail: unknown) => dispatchEvent(new CustomEvent(type, { detail }));
const setWeather = (w: Weather | null) => fire('sky:weather', w);

const WORDS: Record<string, [() => void, string]> = {
  rain: [() => setWeather('rain'), 'you summoned rain.'],
  snow: [() => setWeather('snow'), 'let it snow.'],
  storm: [() => setWeather('storm'), 'batten down the hatches.'],
  fog: [() => setWeather('fog'), 'spooky.'],
  cloudy: [() => setWeather('cloudy'), 'overcast, as requested.'],
  clear: [() => setWeather('clear'), 'clear skies ahead.'],
  forecast: [() => setWeather(null), 'back to the real forecast.'],
  boom: [() => fire('sky:fireworks', 8), 'boom!'],
  cat: [() => fire('sky:cloud', 'cat'), 'look up: a cloud cat.'],
  dog: [() => fire('sky:cloud', 'dog'), 'look up: a cloud dog.'],
  night: [() => fire('sky:set', 23), 'goodnight.'],
  day: [() => fire('sky:set', 12.5), 'good morning!'],
  now: [() => fire('sky:set', null), 'back to your local time.'],
};
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

let k = 0, typed = '';
addEventListener('keydown', (e) => {
  if ((e.target as Element).closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey) return;
  const key = e.key.toLowerCase();
  k = key === KONAMI[k] ? k + 1 : key === KONAMI[0] ? 1 : 0;
  if (k === KONAMI.length) {
    k = 0;
    fire('sky:fireworks', 20);
    toast('+30 lives. enjoy the show.', 'cheat code accepted');
    return;
  }
  if (key.length !== 1) return;
  typed = (typed + key).slice(-12);
  for (const [word, [run, msg]] of Object.entries(WORDS)) {
    if (typed.endsWith(word)) { typed = ''; run(); toast(msg, `secret: "${word}"`); break; }
  }
});

console.log(
  '%c hey, view-source explorer! %c\ntry the konami code, or type "rain" somewhere on the page.',
  'background:#1c3f94;color:#fff;font:bold 14px monospace;padding:4px 8px',
  'font:12px monospace',
);
