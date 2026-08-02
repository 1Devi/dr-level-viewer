import { OBJ, byId } from "./format.js";

/* =====================================================================
   WRITING A LEVEL FILE

     row 0        version, the game reads it and throws it away
     row 1        number of solid lines
     row 2        number of scenery lines
     4 rows per record, solid ones first
     footer: finish, camera, zoom, four object arrays, start,
             z / c sections, five more arrays, v, m, blank, f, d

   UTF-8, CRLF, no newline at the end of the file.
   The editor version is always written as d10.0: with d9.4 the game takes the
   compatibility path and saving there behaves unpredictably.

   One writer serves both callers — Save (a level that came from a file) and
   the image generator (a level built from nothing) — so there is a single
   place where the format can be wrong.
   ===================================================================== */

const f1 = (v) => (Number.isFinite(v) ? v : 0).toFixed(1);
const f2 = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);
const f3 = (v) => (Number.isFinite(v) ? v : 0).toFixed(3);
const int = (v) => String(Math.round(Number.isFinite(v) ? v : 0));
/* zoom is the only field that is sometimes 1 and sometimes 1.21 */
/* roundedF is not a whole number: the game writes 7.5 for a line of width 15 */
const fc = (v) => String(+(+v).toFixed(2));

/* zoom comes in at full precision — 1.0919997692108 in a level the game wrote —
   and goes back out the same */
const fz = (v) => String(+v);

const isBad = (x) => f1(x) === "1.0";

export function guardStartX(lines, shift = 0.1) {
  let n = 0;
  for (const l of lines) {
    if (!isBad(l.x1)) continue;
    l.x1 += shift;
    l.x2 += shift;
    if (isBad(l.x1)) {
      l.x1 += shift;
      l.x2 += shift;
    } // paranoia: .1 always clears it
    n++;
  }
  return n;
}

/* how many records the guard would have to touch — a check without a rewrite */
export function countBadStartX(lines) {
  let n = 0;
  for (const l of lines) if (isBad(l.x1)) n++;
  return n;
}

/* An object record as numbers, straight from what the parser read when it is
   there, so nothing gets invented on the way out. */
function objNums(d, o) {
  if (Array.isArray(o.raw) && o.raw.length >= d.fields) return o.raw.slice(0, d.fields);
  const r = [o.x, o.y];
  if (d.fields >= 3) r.push(o.a || 0);
  if (d.id === "portal") r.push(o.x2 || 0, o.y2 || 0, o.a2 || 0);
  if (d.id === "way") r.push(o.t || 0);
  while (r.length < d.fields) r.push(0);
  return r.slice(0, d.fields);
}

/* way's fourth number picks the sprite (0/1/2) and is an index, not a coordinate */
const objField = (d, v, k) => (d.id === "way" && k === 3 ? int(v) : f1(v));

/* lv accepts both shapes:
     - a level straight out of parse.js
     - {lines, bg, cam, zoom, start, finish} with no objects at all
   -> {text, guarded, nSolid, nDecor, rows} */
export function writeLevel(lv) {
  // a shallow copy per line: the guard nudges coordinates, and the model the
  // viewer is showing must not change under it just because it was saved
  const lines = (lv.lines || []).map((l) => Object.assign({}, l));
  const guarded = guardStartX(lines);
  const solid = lines.filter((l) => l.solid);
  const decor = lines.filter((l) => !l.solid);

  const head = /^-?\d+$/.test(String(lv.head)) ? String(lv.head) : "0";
  const L = [head, String(solid.length), String(decor.length)];

  for (const l of solid.concat(decor)) {
    let row = f1(l.x1) + " " + f2(l.c[0]) + " " + f2(l.c[1]) + " " + f2(l.c[2]) + " " + Math.max(1, Math.round(l.th || 5));
    if (l.cap > 0) row += " " + fc(l.cap); // roundedF, written only when set
    L.push(row, f1(l.y1), f1(l.x2), f1(l.y2));
  }

  const objects = lv.objects || {};
  const list = (id) => objects[id] || [];
  /* an object row, plus anything extra the file kept on it (a narrowed portal
     writes its value next to x2) */
  const objRow = (d, o, v, k) => {
    const row = objField(d, v, k);
    const ex = o.extra && o.extra[k];
    return ex && ex.length ? row + " " + ex.map((x) => String(+(+x).toFixed(3))).join(" ") : row;
  };
  const put = (d) => {
    const items = list(d.id);
    L.push(String(items.length));
    for (const o of items) for (const [k, v] of objNums(d, o).entries()) L.push(objRow(d, o, v, k));
  };
  const putKeyed = (d) => {
    const items = list(d.id);
    L.push(d.key + " " + items.length);
    for (const o of items) for (const [k, v] of objNums(d, o).entries()) L.push(objRow(d, o, v, k));
  };

  const zx = typeof lv.zoom === "number" ? lv.zoom : lv.zoom && lv.zoom.x;
  const zy = typeof lv.zoom === "number" ? lv.zoom : lv.zoom && lv.zoom.y;
  const bg = lv.bg || [1, 1, 1];

  L.push(f1(lv.finish.x), f1(lv.finish.y));
  L.push(f1(lv.cam.x), f1(lv.cam.y));
  L.push(fz(zx === undefined ? 1 : zx), fz(zy === undefined ? 1 : zy));
  for (const d of OBJ) if (d.grp === "A") put(d);
  L.push(f1(lv.start.x), f1(lv.start.y));
  // the optional number the game reads and discards is not written: a letter
  // follows, and the loader rewinds on its own
  putKeyed(byId.zvezd);
  putKeyed(byId.checkpoint);
  for (const d of OBJ) if (d.grp === "B") put(d);
  L.push("v " + (lv.veh || "1"));
  L.push("m " + (lv.gameMode || "0") + " " + (lv.bombTime || "3"));
  L.push("");
  L.push("f " + f3(bg[0]) + " " + f3(bg[1]) + " " + f3(bg[2]));
  L.push("d10.0");

  return { text: L.join("\r\n"), guarded, nSolid: solid.length, nDecor: decor.length, rows: L.length };
}
