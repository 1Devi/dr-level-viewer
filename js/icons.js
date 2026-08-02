/* =====================================================================
   TOOL ICONS

   Drawn here rather than taken from the game: these are ours, they follow the
   interface colours through `currentColor`, and they stay sharp at any zoom.
   The vehicle pictures are still the game's own — those are the vehicles, and
   drawing lookalikes would only make them harder to recognise.

   24x24, stroked, no fills except where a shape needs to read as solid.
   ===================================================================== */

const svg = (body) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";

export const ICON = {
  /* four-way arrow: pan and zoom */
  move: svg('<path d="M12 3v18M3 12h18"/><path d="M12 3l-2.6 2.8M12 3l2.6 2.8' + "M12 21l-2.6-2.8M12 21l2.6-2.8M3 12l2.8-2.6M3 12l2.8 2.6" + 'M21 12l-2.8-2.6M21 12l-2.8 2.6"/>'),

  /* a straight segment between two ends */
  line: svg('<path d="M6.5 17.5 17.5 6.5"/><circle cx="5.5" cy="18.5" r="2"/>' + '<circle cx="18.5" cy="5.5" r="2"/>'),

  /* the same, bent: the brush draws a curve */
  brush: svg('<path d="M5.5 17.5C8 8 16 6.5 18.5 6.5"/><circle cx="4.5" cy="18.5" r="2"/>' + '<circle cx="19.5" cy="5.5" r="2"/>'),

  /* eraser, tilted, with the line it is taking off */
  eraser: svg('<path d="M8.5 19.5 4 15a1.6 1.6 0 0 1 0-2.3l8-8a1.6 1.6 0 0 1 2.3 0l4.6 4.6' + 'a1.6 1.6 0 0 1 0 2.3l-7.6 7.6H8.5z"/><path d="M9 9.5 15.5 16"/><path d="M3 21h18"/>'),

  /* dropper */
  pipette: svg('<path d="m18.5 3.5 2 2a2 2 0 0 1 0 2.8l-1.6 1.6-4.8-4.8 1.6-1.6a2 2 0 0 1 2.8 0z"/>' + '<path d="m13.4 6.6 4 4-8.2 8.2-4.6.6.6-4.6z"/>'),

  /* objects: a star, the object every level has */
  object: svg('<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z"/>'),

  /* start: a flag on a pole */
  start: svg('<path d="M6 21V3"/><path d="M6 4.5h11l-2.6 3.6L17 11.7H6z" fill="currentColor" ' + 'fill-opacity=".18"/>'),

  /* finish: the same pole, chequered */
  finish: svg('<path d="M6 21V3"/><path d="M6 4.5h12v7.5H6z"/><path d="M6 4.5h4v3.75h4V4.5' + 'M10 8.25v3.75h4V8.25h4" fill="currentColor" fill-opacity=".25" stroke="none"/>' + '<path d="M10 4.5v7.5M14 4.5v7.5M6 8.25h12"/>'),

  /* grid */
  grid: svg('<path d="M4 4h16v16H4z"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/>'),

  /* a horseshoe magnet, poles down: the next line starts where the last ended */
  magnet: svg('<path d="M5 20v-8a7 7 0 0 1 14 0v8"/><path d="M9.5 20v-8a2.5 2.5 0 0 1 5 0v8"/>' + '<path d="M5 16h4.5M14.5 16H19"/>' + '<path d="M5 16h4.5v4H5zM14.5 16H19v4h-4.5z" fill="currentColor" ' + 'fill-opacity=".2" stroke="none"/>'),

  /* pointer: pick something and change it */
  choose: svg('<path d="M6 3.2v14.3l3.7-3.5 2.2 5 2.7-1.2-2.3-4.9 5.2-.4z"/>'),

  /* undo; redo is the same icon flipped in CSS */
  undo: svg('<path d="M9 7H5V3"/><path d="M5 7a8 8 0 1 1-1.6 4.8"/>'),

  /* clear everything */
  clear: svg('<path d="M4 6.5h16"/><path d="M9.5 6.5V4h5v2.5"/>' + '<path d="M6.5 6.5 7.6 20a1 1 0 0 0 1 .9h6.8a1 1 0 0 0 1-.9l1.1-13.5"/>' + '<path d="M10.5 10v7M13.5 10v7"/>'),
};
