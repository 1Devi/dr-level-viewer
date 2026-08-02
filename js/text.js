export const DEFAULT_FAMILY = "system-ui, sans-serif";

const RES = 160;
const PAD = 10;

let userFaces = 0;

export async function loadFontFile(file) {
  const buf = await file.arrayBuffer();
  const family = "DRUserFont" + ++userFaces;
  const face = new FontFace(family, buf);
  await face.load();
  document.fonts.add(face);
  return { family: '"' + family + '"', name: file.name };
}

export function rasterize(rows, family, spacingPx, res) {
  const EM = res || RES;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = EM + "px " + family;
  const m = probe.measureText("Hg");
  const asc = m.actualBoundingBoxAscent || EM * 0.8;
  const desc = m.actualBoundingBoxDescent || EM * 0.2;
  const lineH = Math.ceil((asc + desc) * 1.25);

  const widths = rows.map((r) => {
    let w = 0;
    for (const ch of r) w += probe.measureText(ch).width + spacingPx;
    return Math.max(0, w - (r.length ? spacingPx : 0));
  });
  const W = Math.ceil(Math.max(1, ...widths)) + PAD * 2;
  const H = Math.ceil(lineH * rows.length + desc) + PAD * 2;

  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.font = EM + "px " + family;
  g.textBaseline = "alphabetic";
  g.fillStyle = "#fff";

  rows.forEach((row, i) => {
    let x = PAD;
    const y = PAD + Math.ceil(asc) + i * lineH;
    for (const ch of row) {
      g.fillText(ch, x, y);
      x += probe.measureText(ch).width + spacingPx;
    }
  });

  const px = g.getImageData(0, 0, W, H).data;
  const on = new Uint8Array(W * H);
  for (let i = 0; i < on.length; i++) on[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  return { W, H, on, ox: PAD, oy: PAD + Math.ceil(asc), lineH, widths, asc, desc, res: EM };
}

const CASES = [
  [],
  [["l", "t"]],
  [["t", "r"]],
  [["l", "r"]],
  [["r", "b"]],
  [
    ["l", "t"],
    ["r", "b"],
  ],
  [["t", "b"]],
  [["l", "b"]],
  [["b", "l"]],
  [["t", "b"]],
  [
    ["t", "r"],
    ["b", "l"],
  ],
  [["r", "b"]],
  [["l", "r"]],
  [["t", "r"]],
  [["l", "t"]],
  [],
];

export function contours(mask) {
  const { W, H, on } = mask;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : on[y * W + x]);
  const pt = (x, y, side) => (side === "t" ? [x + 0.5, y] : side === "r" ? [x + 1, y + 0.5] : side === "b" ? [x + 0.5, y + 1] : [x, y + 0.5]);

  const key = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
  const links = new Map();
  const add = (a, b) => {
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      const k = key(p);
      let list = links.get(k);
      if (!list) links.set(k, (list = { p, to: [] }));
      list.to.push(q);
    }
  };

  for (let y = -1; y < H; y++)
    for (let x = -1; x < W; x++) {
      const c = at(x, y) | (at(x + 1, y) << 1) | (at(x + 1, y + 1) << 2) | (at(x, y + 1) << 3);
      for (const [a, b] of CASES[c]) add(pt(x, y, a), pt(x, y, b));
    }

  const seen = new Set();
  const loops = [];
  for (const [k, node] of links) {
    if (seen.has(k)) continue;
    const loop = [];
    let cur = node.p,
      ck = k,
      from = null;
    for (let guard = 0; guard < 200000; guard++) {
      seen.add(ck);
      loop.push(cur);
      const node2 = links.get(ck);
      if (!node2) break;
      const next = node2.to.find((q) => key(q) !== from) || node2.to[0];
      if (!next) break;
      from = ck;
      ck = key(next);
      cur = next;
      if (seen.has(ck)) break;
    }

    if (loop.length > 2) {
      const back = links.get(key(loop[loop.length - 1]));
      if (back && back.to.some((q) => key(q) === key(loop[0]))) loop.push(loop[0]);
      loops.push(loop);
    }
  }
  return loops;
}

export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1,
      bd = eps;
    const [ax, ay] = pts[a],
      [bx, by] = pts[b];
    const dx = bx - ax,
      dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function simplifyLoop(pts, eps) {
  if (pts.length < 5) return pts;
  const open = pts.slice(0, -1);
  let m = 0,
    far = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > far) {
      far = d;
      m = i;
    }
  }
  const out = simplify(open.slice(0, m + 1), eps).concat(simplify(open.slice(m), eps).slice(1));
  out.push(out[0]);
  return out;
}

export function distanceMap(mask) {
  const { W, H, on } = mask,
    INF = 1e12;
  const d = new Float64Array(W * H);
  const n = Math.max(W, H);
  const f = new Float64Array(n),
    v = new Int32Array(n + 1),
    z = new Float64Array(n + 2);
  const pass = (get, set, len) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s <= z[k]) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      set(q, (q - v[k]) * (q - v[k]) + f[v[k]]);
    }
  };
  for (let x = 0; x < W; x++)
    pass(
      (y) => (on[y * W + x] ? INF : 0),
      (y, val) => {
        d[y * W + x] = val;
      },
      H,
    );
  for (let y = 0; y < H; y++)
    pass(
      (x) => d[y * W + x],
      (x, val) => {
        d[y * W + x] = val;
      },
      W,
    );
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  return d;
}

function levelContours(field, W, H, level) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1e9 : field[y * W + x]);
  const cross = (xa, ya, xb, yb) => {
    const va = at(xa, ya),
      vb = at(xb, yb);
    const t = Math.abs(vb - va) < 1e-12 ? 0.5 : (level - va) / (vb - va);
    const u = Math.max(0, Math.min(1, t));
    return [xa + (xb - xa) * u, ya + (yb - ya) * u];
  };
  const key = (p) => p[0].toFixed(3) + "," + p[1].toFixed(3);
  const links = new Map();
  const add = (a, b) => {
    if (key(a) === key(b)) return;
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      const k = key(p);
      let node = links.get(k);
      if (!node) links.set(k, (node = { p, to: [] }));
      node.to.push(q);
    }
  };

  for (let y = -1; y < H; y++)
    for (let x = -1; x < W; x++) {
      const c = (at(x, y) >= level ? 1 : 0) | (at(x + 1, y) >= level ? 2 : 0) | (at(x + 1, y + 1) >= level ? 4 : 0) | (at(x, y + 1) >= level ? 8 : 0);
      const edge = (side) => (side === "t" ? cross(x, y, x + 1, y) : side === "r" ? cross(x + 1, y, x + 1, y + 1) : side === "b" ? cross(x, y + 1, x + 1, y + 1) : cross(x, y, x, y + 1));
      for (const [a, b] of CASES[c]) add(edge(a), edge(b));
    }

  const seen = new Set(),
    out = [];
  for (const [k, node] of links) {
    if (seen.has(k)) continue;
    const line = [];
    let cur = node.p,
      ck = k,
      from = null;
    for (let guard = 0; guard < 200000; guard++) {
      seen.add(ck);
      line.push(cur);
      const n = links.get(ck);
      if (!n) break;
      const next = n.to.find((q) => key(q) !== from && key(q) !== ck) || n.to.find((q) => key(q) !== ck);
      if (!next) break;
      from = ck;
      ck = key(next);
      cur = next;
      if (seen.has(ck)) break;
    }
    if (line.length > 2) {
      const back = links.get(key(line[line.length - 1]));
      if (back && back.to.some((q) => key(q) === key(line[0]))) line.push(line[0]);
      out.push(line);
    }
  }
  return out;
}

const simplifyAny = (pts, eps) => {
  const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  return closed ? simplifyLoop(pts, eps) : simplify(pts, eps);
};

const EDGE_DIV = 28,
  FILL_DIV = 24;

const SAFETY = 0.98;
const EDGE_K = 0.96;

function edgeStrokes(mask, t, eps, k) {
  const { W, H } = mask;
  const D = distanceMap(mask);
  let rmax = 0;
  for (const v of D) if (v > rmax) rmax = v;
  const out = [];
  if (rmax <= 0) return out;

  const room = (a, b) => {
    let m = Infinity;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * s) / steps);
      const y = Math.round(a[1] + ((b[1] - a[1]) * s) / steps);
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      m = Math.min(m, D[y * W + x]);
    }
    return m === Infinity ? 0 : m;
  };

  const th0 = Math.max(1, Math.min(t, rmax * 2));
  for (const c of levelContours(D, W, H, Math.min(th0 / 2, rmax * 0.999))) {
    const q = simplifyAny(c, eps);
    if (q.length < 2) continue;
    for (let i = 1; i < q.length; i++) {
      const th = Math.min(th0 * EDGE_K, 2 * room(q[i - 1], q[i]) * SAFETY);
      if (th * k < 0.5) continue;
      out.push({ a: q[i - 1], b: q[i], th });
    }
  }
  return out;
}

/*-----------------FULLY DEVELOPED BY NOTMAXHACK-----------------*/
/*---------------------INSET FILL OF LETTERS---------------------*/
const MAX_INSET = 64;
const INSET_STEP = 0.5;

function insetStrokes(mask, t, eps, stepFrac) {
  const { W, H } = mask;
  const D = distanceMap(mask);
  let rmax = 0;
  for (const v of D) if (v > rmax) rmax = v;
  const out = [];
  if (rmax <= 0) return out;

  const step = Math.max(1, t * (stepFrac || INSET_STEP));
  let pass = 0;
  for (let level = t / 2 + eps; level <= rmax && pass < MAX_INSET; level += step, pass++) {
    for (const c of levelContours(D, W, H, level)) {
      const q = simplifyAny(c, pass ? eps * 2 : eps);
      if (q.length < 2) continue;
      for (let i = 1; i < q.length; i++) out.push({ a: q[i - 1], b: q[i], th: t });
    }
  }
  return out;
}

export function maskToLines(mask, opt) {
  const k = opt.size / (mask.res || RES);
  const ox = opt.ox - mask.ox * k,
    oy = opt.oy - mask.oy * k;
  const put = (x1, y1, x2, y2, th, floor, round) => ({
    x1: +(ox + x1 * k).toFixed(1),
    y1: +(oy + y1 * k).toFixed(1),
    x2: +(ox + x2 * k).toFixed(1),
    y2: +(oy + y2 * k).toFixed(1),
    th: Math.max(1, floor ? Math.floor(th) : Math.round(th)),
    cap: round ? Math.max(1, floor ? Math.floor(th) : Math.round(th)) / 2 : null,
    solid: !!opt.solid,
    c: opt.colour.slice(),
  });
  const out = [];
  const eps = 0.7;
  const edge = Math.max(1, Math.round(opt.width || opt.size / EDGE_DIV));
  const fill = Math.max(1, Math.round(opt.width || opt.size / FILL_DIV));

  if (opt.mode !== "outline") for (const s of insetStrokes(mask, fill / k, eps, opt.step)) out.push(put(s.a[0], s.a[1], s.b[0], s.b[1], s.th * k, true, true));

  for (const s of edgeStrokes(mask, (opt.mode === "outline" ? edge : Math.max(1, Math.round(opt.size / EDGE_DIV))) / k, eps, k)) out.push(put(s.a[0], s.a[1], s.b[0], s.b[1], s.th * k, true));
  return out;
}

export function textToLines(rows, opt) {
  const clean = rows.length ? rows : [""];
  if (!clean.some((r) => r.length)) return [];
  const em = opt.mode === "outline" ? RES : RES * 2;
  const mask = rasterize(clean, opt.family || DEFAULT_FAMILY, (opt.spacing * em) / opt.size, em);
  return maskToLines(mask, opt);
}

export function metrics(rows, opt) {
  const probe = document.createElement("canvas").getContext("2d");
  const family = opt.family || DEFAULT_FAMILY;
  const u = opt.size / RES; // level units per raster pixel
  probe.font = RES + "px " + family;
  const m = probe.measureText("Hg");
  const ascPx = m.actualBoundingBoxAscent || RES * 0.8;
  const descPx = m.actualBoundingBoxDescent || RES * 0.2;
  const cols = (rows.length ? rows : [""]).map((r) => {
    const xs = [0];
    let w = 0;
    for (const ch of r) {
      w += probe.measureText(ch).width * u + opt.spacing;
      xs.push(w);
    }
    return xs;
  });
  return {
    asc: ascPx * u,
    desc: descPx * u,
    lineH: Math.ceil((ascPx + descPx) * 1.25) * u,
    cols,
  };
}

export function hitText(rows, opt, x, y) {
  const M = metrics(rows, opt);
  const n = Math.max(1, rows.length);
  let r = Math.floor((y - opt.oy + M.asc) / M.lineH);
  r = Math.max(0, Math.min(n - 1, r));
  const xs = M.cols[r];
  const rel = x - opt.ox;
  let c = 0,
    best = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - rel);
    if (d < best) {
      best = d;
      c = i;
    }
  }
  return { r, c };
}

export function textBox(rows, opt) {
  const M = metrics(rows, opt);
  let w = 0;
  for (const xs of M.cols) w = Math.max(w, xs[xs.length - 1]);
  return {
    x1: opt.ox,
    y1: opt.oy - M.asc,
    x2: opt.ox + Math.max(w, M.lineH * 0.3),
    y2: opt.oy - M.asc + M.lineH * Math.max(1, rows.length),
  };
}
