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
    skychange: CustomEvent<SkyMath & { h: number }>;
    'sky:set': CustomEvent<number | null>;
    'sky:timelapse': Event;
  }
}
