import type { Weather } from '../sky/forecast';

export type SkyMath = {
  sunP: number; moonP: number; e: number; n: number;
  phase: 'night' | 'dawn' | 'day' | 'dusk'; label: string;
};

declare global {
  interface Window {
    __skyHour(): number;
    __skyOverride: number | null;
    __skyMath(h: number): SkyMath;
  }
  interface WindowEventMap {
    skychange: CustomEvent<SkyMath & { h: number; weather: Weather }>;
    'sky:set': CustomEvent<number | null>;
    'sky:weather': CustomEvent<Weather | null>;
    'sky:fireworks': CustomEvent<number>;
    'sky:timelapse': Event;
    'sky:lapse': CustomEvent<boolean>;
    'sky:cloud': CustomEvent<'cat'>;
    'mc:spawn': CustomEvent<'creeper' | 'zombie' | 'skeleton'>;
    'sky:bloom': Event;
  }
}
