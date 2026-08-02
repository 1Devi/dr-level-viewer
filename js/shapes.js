export const TYPE = {
  RECT: 0,
  ROT_RECT: 1,
  TRIANGLE: 2,
  ELLIPSE: 3,
  ROT_ELLIPSE: 4,
  CIRCLE: 5,
  LINE: 6,
  BEZIER: 7,
  POLYLINE: 8,
};

export const TYPE_NAME = {
  0: "rectangle",
  1: "rotated rectangle",
  2: "triangle",
  3: "ellipse",
  4: "rotated ellipse",
  5: "circle",
  6: "line",
  7: "quadratic bezier",
  8: "polyline",
};

/* everything can be expressed; polyline is readable but not generated, the
   Geometrize demo does not offer it either */
export const DRAWABLE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
export const isDrawable = (t) => DRAWABLE.indexOf(t) >= 0;

/* how many bands a filled curve is cut into, and how many segments a curve
   is walked in, unless the caller says otherwise */
export const DETAIL = 8;

const rad = (a) => (a * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function parseShapeJson(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new Error("not valid JSON: " + e.message);
  }
  const arr = Array.isArray(root) ? root : root && Array.isArray(root.shapes) ? root.shapes : null;
  if (!arr) throw new Error("expected an array of shapes at the top level");

  const shapes = [];
  let skipped = 0,
    undrawable = 0;
  for (const s of arr) {
    if (!s || typeof s !== "object" || !Array.isArray(s.data)) {
      skipped++;
      continue;
    }
    const type = Number(s.type);
    if (!Number.isFinite(type)) {
      skipped++;
      continue;
    }
    const data = s.data.map(Number);
    if (data.some((v) => !Number.isFinite(v))) {
      skipped++;
      continue;
    }
    if (!isDrawable(type)) {
      undrawable++;
      continue;
    }
    const c = Array.isArray(s.color) ? s.color.map(Number) : [0, 0, 0, 255];
    shapes.push({
      type,
      data,
      color: [c[0] || 0, c[1] || 0, c[2] || 0, c.length > 3 ? c[3] : 255],
      score: Number(s.score) || 0,
    });
  }
  return { shapes, skipped, undrawable };
}

export function exportShapeJson(shapes) {
  const rows = shapes.map((s) => '\t{\n\t\t"type": ' + s.type + ',\n\t\t"data": [' + s.data.map((v) => +v.toFixed(2)).join(",") + '],\n\t\t"color": [' + s.color.map((v) => Math.round(v)).join(",") + '],\n\t\t"score": ' + +(s.score || 0).toFixed(6) + "\n\t}");
  return "[\n" + rows.join(",\n") + "\n]\n";
}

/* ---------------------------------------------------------------------
   Shape -> lines, in image pixel space

   Coordinates are continuous with pixel centres on integers: a rectangle
   covering rows 10..20 spans 9.5 .. 20.5 and is 11 units thick. Ignoring
   that inclusive extra unit shrinks every shape by a pixel on each axis and
   opens gaps between neighbours.
   --------------------------------------------------------------------- */

const L = (x1, y1, x2, y2, th, cap) => ({ x1, y1, x2, y2, th, cap: cap || 0 });

/* a rectangle, turned or not, is one line between the midpoints of its two
   short edges, as thick as the rectangle is tall */
function rectLine(d, angle) {
  const x1 = Math.min(d[0], d[2]),
    x2 = Math.max(d[0], d[2]);
  const y1 = Math.min(d[1], d[3]),
    y2 = Math.max(d[1], d[3]);
  const cx = (x1 + x2) / 2,
    cy = (y1 + y2) / 2;
  const half = (x2 - x1 + 1) / 2,
    th = y2 - y1 + 1;
  const a = rad(angle || 0),
    cos = Math.cos(a),
    sin = Math.sin(a);
  return L(cx - half * cos, cy - half * sin, cx + half * cos, cy + half * sin, th, 0);
}

function bands(top, bot, n, span, turn) {
  const out = [];
  const h = (bot - top) / n;
  for (let i = 0; i < n; i++) {
    const cy = top + (i + 0.5) * h;
    const s = span(cy);
    if (!s || s[1] < s[0]) continue;
    out.push(turn ? turn(s[0], cy, s[1], cy, h) : L(s[0], cy, s[1], cy, h, 0));
  }
  return out;
}

function triangleLines(d, n) {
  const pts = [
    [d[0], d[1]],
    [d[2], d[3]],
    [d[4], d[5]],
  ];
  let top = Infinity,
    bot = -Infinity;
  for (const p of pts) {
    top = Math.min(top, p[1]);
    bot = Math.max(bot, p[1]);
  }
  return bands(top - 0.5, bot + 0.5, n, (cy) => {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < 3; i++) {
      const p = pts[i],
        q = pts[(i + 1) % 3];
      if ((p[1] <= cy && q[1] >= cy) || (q[1] <= cy && p[1] >= cy)) {
        if (Math.abs(q[1] - p[1]) < 1e-9) {
          lo = Math.min(lo, p[0], q[0]);
          hi = Math.max(hi, p[0], q[0]);
          continue;
        }
        const x = p[0] + ((q[0] - p[0]) * (cy - p[1])) / (q[1] - p[1]);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    return hi >= lo ? [lo - 0.5, hi + 0.5] : null;
  });
}

function ellipseLines(d, n, angle) {
  const cx = d[0],
    cy = d[1];
  const rx = Math.abs(d[2]) + 0.5,
    ry = Math.abs(d[3]) + 0.5;
  const a = rad(angle || 0),
    cos = Math.cos(a),
    sin = Math.sin(a);
  const turn = angle
    ? (x1, y1, x2, y2, th) => {
        const p = (x, y) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
        const A = p(x1, y1),
          B = p(x2, y2);
        return L(A[0], A[1], B[0], B[1], th, 0);
      }
    : null;
  return bands(
    cy - ry,
    cy + ry,
    n,
    (y) => {
      const t = (y - cy) / ry;
      const w = rx * Math.sqrt(Math.max(0, 1 - t * t));
      return w > 0 ? [cx - w, cx + w] : null;
    },
    turn,
  );
}

function polyLines(pts, th) {
  const out = [];
  for (let i = 1; i < pts.length; i++) out.push(L(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], th, th / 2));
  return out;
}

function bezierPoints(d, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      m = 1 - t;
    pts.push([m * m * d[0] + 2 * m * t * d[2] + t * t * d[4], m * m * d[1] + 2 * m * t * d[3] + t * t * d[5]]);
  }
  return pts;
}

export function toLines(s, detail) {
  const n = clamp(Math.round(detail || DETAIL), 1, 64);
  const d = s.data;

  switch (s.type) {
    case TYPE.RECT:
      return [rectLine(d, 0)];
    case TYPE.ROT_RECT:
      return [rectLine(d, d[4])];
    case TYPE.TRIANGLE:
      return triangleLines(d, n);
    case TYPE.ELLIPSE:
      return ellipseLines(d, n, 0);
    case TYPE.ROT_ELLIPSE:
      return ellipseLines(d, n, d[4]);
    case TYPE.CIRCLE: {
      const r = Math.abs(d[2]) + 0.5;
      return [L(d[0], d[1], d[0], d[1], r * 2, r)];
    }
    case TYPE.LINE:
      return [L(d[0], d[1], d[2], d[3], 1, 0)];
    case TYPE.BEZIER:
      return polyLines(bezierPoints(d, n), 1);
    case TYPE.POLYLINE: {
      const pts = [];
      for (let i = 0; i + 1 < d.length; i += 2) pts.push([d[i], d[i + 1]]);
      return pts.length > 1 ? polyLines(pts, 1) : [];
    }
  }
  return [];
}

export const recordsOf = (shapes, detail) => shapes.reduce((n, s) => n + toLines(s, detail).length, 0);

function colorOf(s) {
  const c = s.flat || s.color;
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/* shapes -> a level in the shape write.js expects.
   opt: {scale, solid, bg, ox, oy, detail} */
export function levelFromShapes(shapes, opt) {
  const o = Object.assign({ scale: 1, solid: false, bg: [1, 1, 1], ox: 100, oy: 100, detail: DETAIL }, opt);
  const k = o.scale,
    ox = o.ox + 0.5 * k,
    oy = o.oy + 0.5 * k;
  const lines = [];
  for (const s of shapes) {
    const c = colorOf(s);
    for (const l of toLines(s, o.detail))
      lines.push({
        x1: ox + l.x1 * k,
        y1: oy + l.y1 * k,
        x2: ox + l.x2 * k,
        y2: oy + l.y2 * k,
        th: Math.max(1, Math.round(l.th * k)),
        cap: l.cap ? Math.max(1, Math.round(l.cap * k)) : 0,
        solid: !!o.solid,
        c,
      });
  }

  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const l of lines) {
    const p = Math.max(l.th, l.cap * 2) / 2;
    x1 = Math.min(x1, l.x1 - p, l.x2 - p);
    x2 = Math.max(x2, l.x1 + p, l.x2 + p);
    y1 = Math.min(y1, l.y1 - p, l.y2 - p);
    y2 = Math.max(y2, l.y1 + p, l.y2 + p);
  }
  if (!Number.isFinite(x1)) {
    x1 = o.ox;
    y1 = o.oy;
    x2 = o.ox;
    y2 = o.oy;
  }

  return {
    lines,
    bg: o.bg,
    cam: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
    zoom: { x: 1, y: 1 },
    start: { x: x1 - 60, y: y1 - 60 },
    finish: { x: x2 + 60, y: y1 - 60 },
  };
}
