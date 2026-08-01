/* =====================================================================
   WRITING A LEVEL FILE

   Layout:

     row 0        version, always 0
     row 1        number of solid lines
     row 2        number of scenery lines
     4 rows per record
     24-row footer

   UTF-8, CRLF, no newline at the end of the file.
   Footer version is d10.0 — d9.4 sends the game down the compatibility path
   and saving there behaves unpredictably.
   ===================================================================== */

const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);

/* ---------------------------------------------------------------------
   The save bug (01_БАГ_СОХРАНЕНИЯ.md): a record whose StartX prints as
   exactly "1.0" is dropped by the editor and takes the whole save with it.
   In Lua t[1.0] and t[1] are the same key, so it most likely collides with
   the first array slot of some internal table.

   guard.py shifts StartX alone; here the whole record moves by 0.1 instead,
   which keeps the length — and therefore the pixel — exactly square.
   --------------------------------------------------------------------- */
const isBad = (x) => f1(x) === "1.0";

export function guardStartX(recs, shift = 0.1) {
  let n = 0;
  for (const r of recs) {
    if (!isBad(r.x1)) continue;
    r.x1 += shift;
    r.x2 += shift;
    if (isBad(r.x1)) {
      r.x1 += shift;
      r.x2 += shift;
    } // paranoia, .1 always clears it
    n++;
  }
  return n;
}

/* Counts how many records the guard would have to touch. Handy for a check
   over a file that came from somewhere else. */
export function countBadStartX(recs) {
  let n = 0;
  for (const r of recs) if (isBad(r.x1)) n++;
  return n;
}

/* lv: {recs, solid, bg, cam, zoom, start, finish}
   -> {text, guarded, nSolid, nDecor, rows} */
export function serializeLevel(lv) {
  const recs = lv.recs;
  const guarded = guardStartX(recs);
  const nSolid = lv.solid ? recs.length : 0;
  const nDecor = lv.solid ? 0 : recs.length;
  const z = lv.zoom === undefined ? 1 : lv.zoom;
  const bg = lv.bg || [1, 1, 1];

  const L = ["0", String(nSolid), String(nDecor)];

  for (const r of recs) {
    let head = f1(r.x1) + " " + f2(r.c[0]) + " " + f2(r.c[1]) + " " + f2(r.c[2]) + " " + Math.max(1, Math.round(r.th));
    if (r.cap > 0) head += " " + Math.round(r.cap); // roundedF, only when > 0
    L.push(head, f1(r.y1), f1(r.x2), f1(r.y2));
  }

  L.push(
    f1(lv.finish.x),
    f1(lv.finish.y), //  0  1  finish
    f1(lv.cam.x),
    f1(lv.cam.y), //  2  3  camera
    String(z),
    String(z), //  4  5  scale, twice
    "0",
    "0",
    "0",
    "0", //  6..9  gr_on / gr_off / turbo / bomb
    f1(lv.start.x),
    f1(lv.start.y), // 10 11  start
    "z 0", // 12     stars
    "c 0", // 13     checkpoints
    "0",
    "0",
    "0",
    "0",
    "0", // 14..18 grav / saw / min / portal / way
    "v 1", // 19     vehicle
    "m 0 3", // 20     mode, bomb time
    "", // 21     the empty row the game expects
    "f " + f3(bg[0]) + " " + f3(bg[1]) + " " + f3(bg[2]),
    "d10.0", // 23     current editor version
  );

  return { text: L.join("\r\n"), guarded, nSolid, nDecor, rows: L.length };
}
