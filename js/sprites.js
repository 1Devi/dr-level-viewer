/* The game's own sprites, copied into assets/sprites (see README).
   SPR holds the urls (the sidebar puts them straight into <img>), IMG the
   decoded images the canvas draws. */

const NAMES = ["turbo", "bomb", "star", "checkpoint", "grav", "saw", "min", "portal", "portal_e", "portal_editor", "portal_e_editor", "way_0", "way_1", "way_2"];

export const SPR = {};
for (const n of NAMES) SPR[n] = "assets/sprites/" + n + ".png";

export const IMG = {};

/* onready fires per sprite, so the canvas can redraw as they arrive */
export function loadSprites(onready) {
  for (const n of NAMES) {
    const im = new Image();
    im.onload = onready;
    im.src = SPR[n];
    IMG[n] = im;
  }
}
