import { OBJ, byId } from "./format.js";

/* Parses a level file into the object the rest of the viewer works with.
   Throws only when the head of the file cannot be a level at all; everything
   else is collected into `warn` so a half-broken file still renders. */
export function parseLevel(text) {
  const L = text.replace(/\r\n?/g, "\n").split("\n");
  while (L.length && L[L.length - 1].trim() === "") L.pop();
  if (L.length < 4) throw new Error("file is too short to be a level");

  const warn = [];
  const f = (s) => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  };

  const head = L[0].trim();

  /* The levels shipped with the game put three more numbers after the version
     row — the times for gold, silver and bronze — and only then the two line
     counts. Editor levels do not.

     Guessing from the values alone is not enough (a medal time can be a round
     number), and neither is looking at the first record: in old files its
     opening row is often just the x coordinate, with the colour and width
     left to their defaults. So both layouts are tried, and the one whose line
     counts actually leave a footer-sized tail behind wins. */
  const intRow = (k) => /^\d+$/.test((L[k] === undefined ? "" : L[k]).trim());
  const layout = (at) => {
    if (!intRow(at) || !intRow(at + 1)) return null;
    const n = parseInt(L[at], 10) + parseInt(L[at + 1], 10);
    const left = L.length - (at + 2 + 4 * n);
    return left < 4 ? null : { at, left }; // no room for a footer, not this one
  };
  const plain = layout(1),
    timed = layout(4);
  const pick = !plain ? timed : timed && timed.left < plain.left ? timed : plain;
  const at = pick ? pick.at : 1;
  const medals = at === 4 ? [f(L[1]), f(L[2]), f(L[3])] : null;

  const nSolid = parseInt(L[at], 10);
  const nDecor = parseInt(L[at + 1], 10);
  if (!Number.isFinite(nSolid) || !Number.isFinite(nDecor)) throw new Error("rows " + (at + 1) + "-" + (at + 2) + " must be line counts, got: " + JSON.stringify(L[at]) + " / " + JSON.stringify(L[at + 1]));

  const total = nSolid + nDecor;
  const lines = [];
  const numeric = (r) => r !== undefined && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(r);
  let bad = 0; // broken rows reported, capped
  let i = at + 2;
  let maxCh = 0;

  for (let k = 0; k < total; k++) {
    if (i + 3 > L.length - 1) {
      warn.push("header claims " + total + " lines, data only covers " + k);
      break;
    }
    const p = L[i].trim().split(/\s+/);
    if (bad < 8 && [p[0], L[i + 1], L[i + 2], L[i + 3]].some((r) => !numeric(r))) {
      warn.push("row " + (i + 1) + ": a coordinate is not a number, read as 0");
      bad++;
    }
    // the loader fills in what a row leaves out: no width means 5, no colour
    // means black. Old levels lean on that, so only a partial row is odd.
    if (p.length > 1 && p.length < 5) warn.push("row " + (i + 1) + ": expected 1 or 5-6 fields, got " + p.length);
    const c = [f(p[1]), f(p[2]), f(p[3])];
    maxCh = Math.max(maxCh, c[0], c[1], c[2]);
    lines.push({
      i: k,
      solid: k < nSolid,
      x1: f(p[0]),
      y1: f(L[i + 1]),
      x2: f(L[i + 2]),
      y2: f(L[i + 3]),
      c,
      th: p.length > 4 ? f(p[4]) : 5,
      cap: p.length > 5 ? f(p[5]) : null,
      src: L.slice(i, i + 4).map((s) => s.trim()),
    });
    i += 4;
  }
  // if the colors look like 0..255, normalise them
  const div = maxCh > 1.0001 ? 255 : 1;
  if (div === 255) {
    warn.push("colors look like 0..255, divided them by 255");
    for (const l of lines) l.c = l.c.map((v) => v / 255);
  }

  /* ---- tail: numbers are read in sequence, a row starting with a letter opens
     a section ---- */
  const tailStart = i;
  const isKey = () => i < L.length && /^[A-Za-z]/.test(L[i].trim());
  const num = () => {
    if (i >= L.length) return 0;
    const v = parseFloat(L[i]);
    i++;
    return Number.isFinite(v) ? v : 0;
  };
  const objects = {};
  for (const d of OBJ) objects[d.id] = [];

  const readRecords = (d, n) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      if (isKey()) {
        warn.push(d.id + ": data ran out after " + k + " of " + n);
        break;
      }
      /* A row may carry more than the one number the record expects — a
         narrowed portal writes its extra value on the same row as x2. The
         loader reads rows, not numbers, so the extra field is optional and
         only ever appears where the game put it. Keep them by row index so
         nothing is lost on the way back out. */
      const r = [],
        extra = {};
      for (let j = 0; j < d.fields; j++) {
        const row = (L[i] === undefined ? "" : L[i]).trim().split(/\s+/);
        if (row.length > 1) extra[j] = row.slice(1).map(f);
        r.push(num());
      }
      const o = { x: r[0], y: r[1], raw: r };
      if (Object.keys(extra).length) o.extra = extra;
      if (d.fields >= 3) o.a = r[2];
      if (d.id === "portal") {
        o.x2 = r[3];
        o.y2 = r[4];
        o.a2 = r[5];
      }
      if (d.id === "way") o.t = r[3];
      out.push(o);
    }
    return out;
  };
  const readList = (d) => {
    if (isKey()) return [];
    const n = Math.max(0, Math.round(num()));
    return readRecords(d, n);
  };
  // the game tries to read a number and discards it; if a letter is next, it rewinds
  const skipped = [];
  const probe = () => {
    if (!isKey() && i < L.length && L[i].trim() !== "") skipped.push(num());
  };

  const finish = { x: num(), y: num() };
  const cam = { x: num(), y: num() };
  const zoom = { x: num(), y: num() };
  for (const d of OBJ) if (d.grp === "A") objects[d.id] = readList(d);
  const start = { x: num(), y: num() };
  probe();

  const sections = [];
  /* The z and c sections are optional in older files, which simply do not have
     them. Reading whatever letter happens to be there as if it were z would eat
     the v / m / f / d rows behind it and lose the vehicle, the mode and the
     background, so a row with the wrong letter is left alone. */
  const readKeyed = (d) => {
    if (!isKey()) return [];
    const t = L[i].trim();
    const m = /^([A-Za-z])[ \t]*(.*)$/.exec(t);
    if (m[1].toLowerCase() !== d.key) {
      warn.push('no "' + d.key + '" section, the file goes straight to "' + m[1] + '"');
      return [];
    }
    i++;
    sections.push({ key: m[1].toLowerCase(), args: m[2].trim(), raw: t });
    const n = Math.max(0, parseInt(m[2], 10) || 0);
    return readRecords(d, n);
  };
  objects.zvezd = readKeyed(byId.zvezd);
  probe();
  objects.checkpoint = readKeyed(byId.checkpoint);
  for (const d of OBJ) if (d.grp === "B") objects[d.id] = readList(d);

  // the rest: letter sections v / m / f / d
  let cur = null;
  for (; i < L.length; i++) {
    const t = L[i].trim();
    const m = /^([A-Za-z])[ \t]*(.*)$/.exec(t);
    if (m) {
      cur = { key: m[1].toLowerCase(), args: m[2].trim(), raw: t, nums: [] };
      sections.push(cur);
    } else if (t !== "" && cur) {
      cur.nums.push(f(t));
      cur.raw += "\n" + t;
    } else if (t !== "") {
      warn.push("unread number in the tail: " + t);
    }
  }
  const sec = (k) => sections.find((s) => s.key === k);

  const fa = sec("f") ? sec("f").args.split(/\s+/).map(f) : null;
  const bg = fa && fa.length >= 3 ? [fa[0] / div, fa[1] / div, fa[2] / div] : [1, 1, 1];
  const mode = sec("m") ? sec("m").args.split(/\s+/) : [];

  let nObj = 0;
  for (const d of OBJ) nObj += objects[d.id].length;

  return {
    head,
    nSolid,
    nDecor,
    lines,
    objects,
    sections,
    bg,
    nObj,
    skipped,
    medals,
    finish,
    cam,
    zoom,
    start,
    editor: sec("d") ? sec("d").args : "",
    veh: sec("v") ? sec("v").args : "",
    gameMode: mode[0] || "",
    bombTime: mode[1] || "",
    warn,
    tailRaw: L.slice(tailStart).join("\n"),
  };
}
