// Web radio stations: music-only streams (no hosts). All stream over HTTPS (required on an https site) and send CORS
// headers, which lets the radio draw a live spectrum. Check a stream still works with:
//   curl -sI <url>   (expect 200 + audio/*)
export type Station = { id: string; label: string; name: string; genre: string; url: string; home: string; via: string };

export const STATIONS: Station[] = [
  {
    id: 'synth', label: 'synth', name: 'Nightride FM: Chillsynth', genre: 'chill synthwave',
    url: 'https://stream.nightride.fm/chillsynth.mp3', home: 'https://nightride.fm/?station=chillsynth', via: 'nightride.fm',
  },
  {
    id: 'jazz', label: 'jazzhop', name: 'Epic Lounge: Jazzhop', genre: 'jazzy hip-hop, chillhop',
    url: 'https://stream.epic-lounge.com/jazzhop-lounge', home: 'https://epic-lounge.com/', via: 'epic-lounge.com',
  },
  {
    // Funky house and nu-disco (192k): the groovy, vocal, Future Nostalgia-ish end of house.
    // Tested alternative: https://streaming.hotmixradio.com/hotmix-nu_disco-en-mp3 (Hotmix Nu Disco).
    id: 'house', label: 'house', name: 'Technolovers: Funky House', genre: 'funky house, nu-disco',
    url: 'https://stream.technolovers.fm/funky-house', home: 'https://www.technolovers.fm/', via: 'technolovers.fm',
  },
  {
    // Atmospheric/liquid drum & bass and jungle, the 2000s Good Looking-style sound. Automated
    // stream (track titles in the metadata), not live DJ shows with hosts.
    id: 'dnb', label: 'dnb', name: 'Atmospheric DnB s0urce', genre: 'atmospheric & liquid dnb, jungle',
    url: 'https://brokenbeats.net/stream/aac', home: 'https://brokenbeats.net/', via: 'brokenbeats.net',
  },
];
