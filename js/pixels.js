/* =====================================================================
   IMAGE -> LEVEL, the arithmetic part.

   No DOM here on purpose: the browser only samples the image down to a small
   RGBA grid, everything after that is plain numbers and can be tested alone.

   One image pixel becomes one line record. The game draws a line as a
   rotated rectangle: width = distance between the endpoints, height = sizeF.
   So a horizontal record whose endpoints sit
   on the left and right edge midpoints of a cell, with sizeF = cell size,
   covers exactly that cell - a square pixel, no gaps, no overlap:

       x1 = ox + px*S          y1 = oy + py*S + S/2
       x2 = x1 + S             y2 = y1              th = S

   The 6th field (roundedF) stays absent: round caps would make the pixel
   stick out by S/2 on both sides.
   ===================================================================== */

export const DEFAULTS = {
  width: 96, // grid width in image pixels, height follows the aspect
  size: 10, // level units per pixel; also the line thickness (integer)
  solid: false, // false -> scenery (decor), true -> physical lines
  alpha: 8, // pixels with alpha below this are dropped
  skipBg: false, // drop pixels close to `key`
  key: [255, 255, 255],
  tol: 12, // per-channel tolerance for the above
  post: 0, // posterize levels per channel, 0/1 = off
  merge: false, // merge equal neighbours in a row into one record
  ox: 100,
  oy: 100, // top-left corner of the picture in level coordinates
  bg: [1, 1, 1], // level background
};

/* colours are written as %.2f, i.e. 101 steps per channel — quantise here so
   what the preview shows is what the file gets */
const c2 = (v) => Math.round((v / 255) * 100) / 100;

const post1 = (v, n) => {
  const q = n - 1;
  return Math.round((Math.round((v / 255) * q) / q) * 255);
};

const near = (r, g, b, k, tol) => Math.abs(r - k[0]) <= tol && Math.abs(g - k[1]) <= tol && Math.abs(b - k[2]) <= tol;

/* px: {W, H, data} — data is RGBA, exactly like ImageData.data
   -> array of records {x1, y1, x2, y2, c:[r,g,b] 0..1, th} */
export function buildRecords(px, opt) {
  const o = Object.assign({}, DEFAULTS, opt);
  const S = Math.max(1, Math.round(o.size));
  const { W, H, data } = px;
  const recs = [];

  for (let y = 0; y < H; y++) {
    const cy = o.oy + y * S + S / 2;
    let run = null; // {x0, n, r, g, b}
    const flush = () => {
      if (!run) return;
      const x1 = o.ox + run.x0 * S;
      recs.push({
        x1,
        y1: cy,
        x2: x1 + run.n * S,
        y2: cy,
        c: [c2(run.r), c2(run.g), c2(run.b)],
        th: S,
        cap: 0,
        solid: !!o.solid,
      });
      run = null;
    };

    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      let keep = data[i + 3] >= o.alpha;
      if (keep && o.post > 1) {
        r = post1(r, o.post);
        g = post1(g, o.post);
        b = post1(b, o.post);
      }
      if (keep && o.skipBg && near(r, g, b, o.key, o.tol)) keep = false;

      if (!keep) {
        flush();
        continue;
      }
      if (o.merge && run && run.r === r && run.g === g && run.b === b) {
        run.n++;
        continue;
      }
      flush();
      run = { x0: x, n: 1, r, g, b };
    }
    flush();
  }
  return recs;
}

/* A level in the shape write.js expects: lines plus the footer values.
   No objects — a picture is lines and nothing else. */
export function levelFromPixels(px, opt) {
  const o = Object.assign({}, DEFAULTS, opt);
  const S = Math.max(1, Math.round(o.size));
  const w = px.W * S,
    h = px.H * S;
  return {
    lines: buildRecords(px, o),
    bg: o.bg,
    cam: { x: o.ox + w / 2, y: o.oy + h / 2 },
    zoom: { x: 1, y: 1 },
    start: { x: o.ox - 60, y: o.oy - 60 },
    finish: { x: o.ox + w + 60, y: o.oy - 60 },
  };
}
