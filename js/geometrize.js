import { TYPE, toLines, DETAIL } from "./shapes.js";

export const DEFAULTS = {
  types: [TYPE.ROT_RECT],
  candidates: 50, // random shapes tried per step
  mutations: 100, // hill-climbing steps on the best of them
  alpha: 128, // 1..255, how solid each added shape is
  detail: DETAIL, // bands per filled curve, segments per curve
  seed: 1,
};

const clampTo = (v, n) => Math.max(0, Math.min(n - 1, v));

/* xorshift, so a run can be repeated exactly */
function rng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function averageColor(px) {
  const d = px.data;
  let r = 0,
    g = 0,
    b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export class Geometrizer {
  /* px: {W, H, data} — the target, RGBA */
  constructor(px, opt) {
    const o = Object.assign({}, DEFAULTS, opt);
    this.o = o;
    this.W = px.W;
    this.H = px.H;
    this.target = px.data;
    this.rand = rng(o.seed);

    this.bg = o.bg || averageColor(px);
    this.current = new Uint8ClampedArray(this.W * this.H * 4);
    for (let i = 0; i < this.current.length; i += 4) {
      this.current[i] = this.bg[0];
      this.current[i + 1] = this.bg[1];
      this.current[i + 2] = this.bg[2];
      this.current[i + 3] = 255;
    }
    this.total = this.errorFull();
    this.shapes = [];
  }

  /* 0..1, the number the UI shows: root mean square error per channel */
  get score() {
    return Math.sqrt(this.total / (this.W * this.H * 3)) / 255;
  }

  errorFull() {
    let t = 0;
    for (let i = 0; i < this.target.length; i += 4)
      for (let k = 0; k < 3; k++) {
        const d = this.target[i + k] - this.current[i + k];
        t += d * d;
      }
    return t;
  }

  /* ---------- one shape ---------- */
  step() {
    let best = null,
      bestErr = Infinity;
    for (let i = 0; i < this.o.candidates; i++) {
      const s = this.random();
      const e = this.energy(s);
      if (e < bestErr) {
        bestErr = e;
        best = s;
      }
    }
    if (!best) return null;

    for (let i = 0; i < this.o.mutations; i++) {
      const s = this.mutate(best);
      const e = this.energy(s);
      if (e < bestErr) {
        bestErr = e;
        best = s;
      }
    }

    if (!(bestErr < this.total)) return null; // nothing left to gain
    const rec = this.commit(best, bestErr);
    this.shapes.push(rec);
    return rec;
  }

  /* draw the shape in and record what it turned out to look like */
  commit(s, err) {
    const lines = this.raster(s);
    const color = this.colorFor(lines);
    const a = this.o.alpha / 255;
    const cur = this.current,
      W = this.W;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (const sl of lines) {
      for (let x = sl.x1; x <= sl.x2; x++) {
        const i = (sl.y * W + x) * 4;
        cur[i] += (color[0] - cur[i]) * a;
        cur[i + 1] += (color[1] - cur[i + 1]) * a;
        cur[i + 2] += (color[2] - cur[i + 2]) * a;
        r += cur[i];
        g += cur[i + 1];
        b += cur[i + 2];
        n++;
      }
    }
    this.total = err;
    return {
      type: s.type,
      data: s.data.slice(),
      color: [color[0], color[1], color[2], this.o.alpha],
      // the average of the result over the shape's own pixels: drawn opaque in
      // the same order, this reproduces what the preview shows
      flat: n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : color.slice(0, 3),
      score: Math.sqrt(err / (this.W * this.H * 3)) / 255,
    };
  }

  /* the total error this shape would leave behind */
  energy(s) {
    const lines = this.raster(s);
    if (!lines.length) return Infinity;
    const color = this.colorFor(lines);
    const a = this.o.alpha / 255;
    const { target, current, W } = this;
    let total = this.total;
    for (const sl of lines) {
      for (let x = sl.x1; x <= sl.x2; x++) {
        const i = (sl.y * W + x) * 4;
        for (let k = 0; k < 3; k++) {
          const t = target[i + k],
            c = current[i + k];
          const n = c + (color[k] - c) * a;
          total -= (t - c) * (t - c);
          total += (t - n) * (t - n);
        }
      }
    }
    return total;
  }

  /* the colour that leaves the least error under the shape, given alpha */
  colorFor(lines) {
    const { target, current, W } = this;
    const f = 255 / this.o.alpha;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (const sl of lines) {
      for (let x = sl.x1; x <= sl.x2; x++) {
        const i = (sl.y * W + x) * 4;
        r += (target[i] - current[i]) * f + current[i];
        g += (target[i + 1] - current[i + 1]) * f + current[i + 1];
        b += (target[i + 2] - current[i + 2]) * f + current[i + 2];
        n++;
      }
    }
    if (!n) return [0, 0, 0];
    const cl = (v) => Math.max(0, Math.min(255, Math.round(v / n)));
    return [cl(r), cl(g), cl(b)];
  }

  /* ---------- shapes ---------- */
  pick() {
    const t = this.o.types;
    return t[Math.floor(this.rand() * t.length) % t.length];
  }
  ri(n) {
    return Math.floor(this.rand() * n);
  }
  /* small signed jitter, the hill-climbing step size */
  jitter(m) {
    return Math.round((this.rand() * 2 - 1) * m);
  }

  random() {
    const W = this.W,
      H = this.H,
      t = this.pick();
    const x = this.ri(W),
      y = this.ri(H);
    const near = (m) => [clampTo(x + this.jitter(m), W), clampTo(y + this.jitter(m), H)];

    if (t === TYPE.CIRCLE) return { type: t, data: [x, y, 1 + this.ri(Math.max(2, ((W + H) / 16) | 0))] };
    if (t === TYPE.LINE) {
      const p = near(32);
      return { type: t, data: [x, y, p[0], p[1]] };
    }
    if (t === TYPE.TRIANGLE) {
      const a = near(32),
        b = near(32);
      return { type: t, data: [x, y, a[0], a[1], b[0], b[1]] };
    }
    if (t === TYPE.BEZIER) {
      const a = near(32),
        b = near(32);
      return { type: t, data: [x, y, a[0], a[1], b[0], b[1]] };
    }
    if (t === TYPE.ELLIPSE || t === TYPE.ROT_ELLIPSE) {
      const d = [x, y, 1 + this.ri(32), 1 + this.ri(32)];
      return t === TYPE.ROT_ELLIPSE ? { type: t, data: d.concat(this.ri(360)) } : { type: t, data: d };
    }
    const w = 1 + this.ri(32),
      h = 1 + this.ri(32);
    const d = [x, y, x + w, y + h];
    return t === TYPE.ROT_RECT ? { type: t, data: d.concat(this.ri(360)) } : { type: t, data: d };
  }

  mutate(s) {
    const d = s.data.slice(),
      W = this.W,
      H = this.H;
    const cx = (v) => clampTo(v + this.jitter(16), W);
    const cy = (v) => clampTo(v + this.jitter(16), H);

    if (s.type === TYPE.CIRCLE) {
      if (this.rand() < 0.5) {
        d[0] = cx(d[0]);
        d[1] = cy(d[1]);
      } else d[2] = Math.max(1, d[2] + this.jitter(16));
    } else if (s.type === TYPE.ELLIPSE || s.type === TYPE.ROT_ELLIPSE) {
      const r = this.rand();
      if (s.type === TYPE.ROT_ELLIPSE && r < 0.25) d[4] = (d[4] + this.jitter(32) + 360) % 360;
      else if (r < 0.6) {
        d[0] = cx(d[0]);
        d[1] = cy(d[1]);
      } else {
        d[2] = Math.max(1, d[2] + this.jitter(16));
        d[3] = Math.max(1, d[3] + this.jitter(16));
      }
    } else if (s.type === TYPE.TRIANGLE || s.type === TYPE.BEZIER) {
      // one corner or control point at a time
      const k = this.ri(3) * 2;
      d[k] = cx(d[k]);
      d[k + 1] = cy(d[k + 1]);
    } else if (s.type === TYPE.ROT_RECT && this.rand() < 0.25) {
      d[4] = (d[4] + this.jitter(32) + 360) % 360;
    } else if (this.rand() < 0.5) {
      d[0] = cx(d[0]);
      d[1] = cy(d[1]);
    } else {
      d[2] = cx(d[2]);
      d[3] = cy(d[3]);
    }
    return { type: s.type, data: d };
  }

  /* ---------- rasterizing ---------- */
  /* Every shape becomes the primitive the game can draw — a rotated
     rectangle, optionally with round ends — and that is what gets rasterized.
     Shapes made of several lines are rasterized as their union, so a pixel
     two bands share is still counted once and the error stays honest. */
  raster(shape) {
    const lines = toLines(shape, this.o.detail);
    if (lines.length === 1) return this.capsule(lines[0]);

    const rows = new Map();
    for (const l of lines)
      for (const sl of this.capsule(l)) {
        let a = rows.get(sl.y);
        if (!a) rows.set(sl.y, (a = []));
        a.push(sl);
      }
    const out = [];
    for (const [y, arr] of rows) {
      arr.sort((p, q) => p.x1 - q.x1);
      let cur = null;
      for (const sl of arr) {
        if (cur && sl.x1 <= cur.x2 + 1) cur.x2 = Math.max(cur.x2, sl.x2);
        else {
          if (cur) out.push(cur);
          cur = { y, x1: sl.x1, x2: sl.x2 };
        }
      }
      if (cur) out.push(cur);
    }
    return out;
  }

  /* -> [{y, x1, x2}] clipped to the image, x2 inclusive.
     A capsule is convex, so each row is a single interval: the widest span
     the body or either round end contributes. A pixel counts as covered when
     its centre is inside, hence ceil/floor rather than rounding. */
  capsule(l) {
    const out = [],
      W = this.W,
      H = this.H;
    const dx = l.x2 - l.x1,
      dy = l.y2 - l.y1;
    const len = Math.hypot(dx, dy);
    const ux = len < 1e-9 ? 1 : dx / len,
      uy = len < 1e-9 ? 0 : dy / len;
    const nx = (-uy * l.th) / 2,
      ny = (ux * l.th) / 2;
    const quad = [
      [l.x1 + nx, l.y1 + ny],
      [l.x2 + nx, l.y2 + ny],
      [l.x2 - nx, l.y2 - ny],
      [l.x1 - nx, l.y1 - ny],
    ];
    const r = l.cap ? l.th / 2 : 0;

    let top = Infinity,
      bot = -Infinity;
    for (const p of quad) {
      top = Math.min(top, p[1]);
      bot = Math.max(bot, p[1]);
    }
    if (r) {
      top = Math.min(top, l.y1 - r, l.y2 - r);
      bot = Math.max(bot, l.y1 + r, l.y2 + r);
    }
    const y0 = Math.max(0, Math.ceil(top)),
      y1 = Math.min(H - 1, Math.floor(bot));

    for (let y = y0; y <= y1; y++) {
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < 4; i++) {
        const p = quad[i],
          q = quad[(i + 1) % 4];
        if ((p[1] <= y && q[1] >= y) || (q[1] <= y && p[1] >= y)) {
          if (Math.abs(q[1] - p[1]) < 1e-9) {
            lo = Math.min(lo, p[0], q[0]);
            hi = Math.max(hi, p[0], q[0]);
            continue;
          }
          const t = (y - p[1]) / (q[1] - p[1]);
          const x = p[0] + (q[0] - p[0]) * t;
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
      }
      if (r)
        for (const e of [
          [l.x1, l.y1],
          [l.x2, l.y2],
        ]) {
          const d2 = r * r - (y - e[1]) * (y - e[1]);
          if (d2 >= 0) {
            const w = Math.sqrt(d2);
            lo = Math.min(lo, e[0] - w);
            hi = Math.max(hi, e[0] + w);
          }
        }
      if (hi < lo) continue;
      const a = Math.max(0, Math.ceil(lo)),
        b = Math.min(W - 1, Math.floor(hi));
      if (b >= a) out.push({ y, x1: a, x2: b });
    }
    return out;
  }
}
