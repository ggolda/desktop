// One 24x24 SVG path per source type; every implementation renders
// <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0 fill-current"><path d={ICONS[type]} /></svg>
export const ICONS = {
  camera: 'M4 6h11a2 2 0 0 1 2 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  display: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  browser: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 0 0-7.4 5h14.8A8 8 0 0 0 12 4zm-8 7v2h16v-2z',
  image: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm1 13h14l-4.5-6-3.5 4.5-2.5-3z',
  audio: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-7 9h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-2.1A7 7 0 0 1 5 12z',
};
