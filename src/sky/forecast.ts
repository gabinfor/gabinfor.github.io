// Pure weather data (no DOM) so pages can import it at build time.
import { rng } from './palette';

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const;
export type Weather = (typeof WEATHERS)[number];
export const isWeather = (s: unknown): s is Weather => WEATHERS.includes(s as Weather);

export type Profile = { cover: number; gloom: number; rain: number; snow: number; fog: number; wind: number; lightning: number };
export const PROFILES: Record<Weather, Profile> = {
  clear: { cover: 0.12, gloom: 0, rain: 0, snow: 0, fog: 0, wind: 1, lightning: 0 },
  cloudy: { cover: 0.6, gloom: 0.15, rain: 0, snow: 0, fog: 0, wind: 1.3, lightning: 0 },
  rain: { cover: 0.85, gloom: 0.45, rain: 1, snow: 0, fog: 0, wind: 1.6, lightning: 0 },
  storm: { cover: 1, gloom: 0.75, rain: 1.6, snow: 0, fog: 0, wind: 2.6, lightning: 1 },
  snow: { cover: 0.75, gloom: 0.3, rain: 0, snow: 1, fog: 0, wind: 0.6, lightning: 0 },
  fog: { cover: 0.35, gloom: 0.25, rain: 0, snow: 0, fog: 1, wind: 0.4, lightning: 0 },
};

// Odds per season (northern-hemisphere months).
const SEASONS: Record<'winter' | 'mid' | 'summer', [Weather, number][]> = {
  winter: [['clear', 0.3], ['cloudy', 0.25], ['snow', 0.25], ['fog', 0.1], ['rain', 0.1]],
  mid: [['clear', 0.4], ['cloudy', 0.25], ['rain', 0.2], ['fog', 0.08], ['storm', 0.07]],
  summer: [['clear', 0.55], ['cloudy', 0.2], ['rain', 0.1], ['storm', 0.12], ['fog', 0.03]],
};

/**
 * Pretend weather: the same for everyone at a given local date and 4-hour block,
 * so it stays put across page loads but changes through the day.
 */
export function forecast(d = new Date()): Weather {
  const m = d.getMonth(), day = d.getDate();
  if (m === 11 && day >= 24 && day <= 26) return 'snow';
  const seed = (d.getFullYear() * 10000 + (m + 1) * 100 + day) * 8 + Math.floor(d.getHours() / 4);
  const r = rng(seed)();
  const table = SEASONS[m === 11 || m <= 1 ? 'winter' : m >= 5 && m <= 7 ? 'summer' : 'mid'];
  let acc = 0;
  for (const [w, p] of table) if (r < (acc += p)) return w;
  return 'clear';
}
