import { state } from "./state.js";
import { $, rgb, lum } from "./util.js";
import { OBJ, byId, FINISH_SIZE, FINISH_COLOR, START_SIZE, START_COLOR } from "./format.js";
import { lineKey, levelBounds } from "./level.js";
import { IMG } from "./sprites.js";
import { saveView } from "./hash.js";

export const cv = $("cv");
const ctx = cv.getContext("2d");
const stage = $("stage");

export const toScr = (x, y) => [(x - state.cam.x) * state.z + state.W / 2, (y - state.cam.y) * state.z + state.H / 2];
export const toLvl = (sx, sy) => [(sx - state.W / 2) / state.z + state.cam.x, (sy - state.H / 2) / state.z + state.cam.y];

export function resize() {
  const r = stage.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  state.W = Math.max(1, Math.round(r.width));
  state.H = Math.max(1, Math.round(r.height));
  cv.width = Math.round(state.W * state.dpr);
  cv.height = Math.round(state.H * state.dpr);
  draw();
}

export function initView() {
  new ResizeObserver(resize).observe(stage);
  resize();
}

/* ---------- rendering ---------- */
export function draw() {
  const { lv, show, hidden, hover, W, H, dpr } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!lv) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--sunk") || "#eee";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  ctx.fillStyle = show.bg ? rgb(lv.bg) : "#fff";
  ctx.fillRect(0, 0, W, H);

  const dark = show.bg && lum(lv.bg) < 0.45;
  if (show.grid) drawGrid(dark);

  ctx.lineJoin = "round";
  for (const pass of [false, true]) {
    // decor first, then solid
    for (const l of lv.lines) {
      if (l.solid !== pass) continue;
      if (!(l.solid ? show.solid : show.decor)) continue;
      if (hidden.has(lineKey(l))) continue;
      stroke(l, show.wire);
    }
  }

  if (hover && hover.x1 !== undefined) stroke(hover, true, "#ff0055", 2);

  // the line the editor is in the middle of drawing, painted for real and
  // outlined so it reads even against its own colour
  if (state.ghost)
    for (const g of state.ghost) {
      stroke(g, false);
      stroke(g, true, "#ff0055", 1);
    }

  if (show.obj) drawObjects();
  if (hover && hover.def) hiliteObj(hover, "#ff0055");

  // what the choose tool has hold of
  const sel = state.sel;
  if (sel && sel.kind === "lines") for (const l of sel.list) stroke(l, true, "#22c55e", 2);
  else if (sel) hiliteObj({ def: byId[sel.id], o: sel.o, second: sel.second }, "#22c55e");
  if (state.eraseAt) {
    const [ex, ey] = toScr(state.eraseAt.x, state.eraseAt.y);
    ctx.strokeStyle = "#ff0055";
    ctx.lineWidth = 1.25;
    ctx.lineCap = "butt";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(ex, ey, Math.max(state.eraseAt.r * state.z, 2), 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // the text caret and its selection: interface, not level geometry
  if (state.caret) {
    const c = state.caret;
    for (const sl of c.sel || []) {
      const a = toScr(sl.x1, sl.y - sl.asc),
        b = toScr(sl.x2, sl.y + sl.desc);
      ctx.fillStyle = "rgba(2,132,199,.25)";
      ctx.fillRect(a[0], a[1], Math.max(b[0] - a[0], 1), Math.max(b[1] - a[1], 1));
    }
    const p1 = toScr(c.x, c.y - c.asc),
      p2 = toScr(c.x, c.y + c.desc);
    ctx.strokeStyle = "#0284c7";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "butt";
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  }

  if (show.finish) finishBox(lv.finish);
  if (show.start) startMark(lv.start);
}

function drawObjects() {
  const { lv, hidden } = state;
  for (const d of OBJ) {
    if (hidden.has("o|" + d.id)) continue;
    for (const o of lv.objects[d.id]) {
      if (d.id === "portal") {
        // `half` is an entrance the editor has placed but whose exit has not
        // been put down yet — drawing it would show a portal the user has not
        // made, sitting exactly on top of the one they are aiming
        // a portal carrying the extra value on its x2 row is drawn with the
        // game's other pair of sprites, the _editor one
        const alt = o.extra && o.extra[3] && o.extra[3][0] ? "_editor" : "";
        if (o.half) {
          sprite(d, "portal" + alt, o.x, o.y, o.a);
          continue;
        }
        const a = toScr(o.x, o.y),
          b = toScr(o.x2, o.y2);
        ctx.strokeStyle = "#ff3b30";
        ctx.lineWidth = 1;
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        sprite(d, "portal" + alt, o.x, o.y, o.a);
        sprite(d, "portal_e" + alt, o.x2, o.y2, o.a2);
      } else if (d.circle) {
        const [x, y] = toScr(o.x, o.y);
        const r = (d.size / 2) * state.z;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(r, 1.5), 0, 7);
        ctx.fillStyle = d.circle;
        ctx.fill();
        if (r > 3) {
          ctx.lineWidth = Math.max(3 * state.z, 1);
          ctx.strokeStyle = "#aaaaaa";
          ctx.stroke();
        }
      } else {
        sprite(d, d.id === "way" ? "way_" + (o.t === 1 ? 1 : o.t === 2 ? 2 : 0) : d.spr, o.x, o.y, o.a);
      }
    }
  }
}

function hiliteObj(h, color) {
  const p = h.second ? [h.o.x2, h.o.y2] : [h.o.x, h.o.y];
  const [x, y] = toScr(p[0], p[1]);
  const r = Math.max((h.def.size / 2) * state.z, 5) + 3;
  ctx.strokeStyle = color || "#ff0055";
  ctx.lineWidth = 2;
  ctx.lineCap = "butt";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.stroke();
  ctx.setLineDash([]);
}

function sprite(d, name, x, y, ang) {
  const im = IMG[name];
  const s = d.size * state.z;
  const [sx, sy] = toScr(x, y);
  if (!im || !im.complete || !im.naturalWidth || s < 2.5) {
    // sprite not ready, or the object is smaller than a pixel: draw a dot
    ctx.fillStyle = "#ff3b30";
    ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    return;
  }
  ctx.save();
  ctx.translate(sx, sy);
  if (ang) ctx.rotate((ang * Math.PI) / 180);
  ctx.drawImage(im, -s / 2, -s / 2, s, s);
  ctx.restore();
}

function stroke(l, wire, color, extra) {
  const [x1, y1] = toScr(l.x1, l.y1),
    [x2, y2] = toScr(l.x2, l.y2);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineCap = l.cap !== null ? "round" : "butt";
  if (wire) {
    ctx.lineWidth = extra || 1.25;
    ctx.strokeStyle = color || (lum(l.c) > 0.5 ? "#000" : "#fff");
    ctx.setLineDash(color ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.lineWidth = Math.max(l.th * state.z, 0.6);
    ctx.strokeStyle = rgb(l.c);
    ctx.stroke();
  }
}

/* The game's own grid is a shader (filter.custom.setka in the apk):

     if(mod(x, grid*10) <= 2)  colour 0.7 grey, so a 2px line
     if(mod(x, grid)    <= 1)  colour 0.9 grey, so a 1px line

   Same two steps in a ten-to-one ratio, and the greys are what black at 10.2%
   and 30.2% comes to over white — which is where these alphas came from in the
   first place. What is reproduced here is the width of each line and the ratio;
   what is deliberately not is the fixed grey: on a dark level background the
   lines invert, or they would vanish. */
function drawGrid(dark) {
  // below ~2.5 px a step merges into a solid wash, so the fine one is dropped
  // there — the shader has no such guard because the game never zooms that far
  const minor = 10,
    major = 100;
  const { W, H, z } = state;
  const [lx1, ly1] = toLvl(0, 0),
    [lx2, ly2] = toLvl(W, H);
  const g = (step, alpha, w) => {
    if (step * z < 2.5 || (lx2 - lx1) / step > 6000) return;
    ctx.strokeStyle = "rgba(" + (dark ? "255,255,255," : "0,0,0,") + alpha + ")";
    ctx.lineWidth = w;
    ctx.lineCap = "butt";
    ctx.beginPath();
    // a 1px line wants the half-pixel offset to stay crisp, a 2px one does not
    const half = w % 2 ? 0.5 : 0;
    for (let x = Math.ceil(lx1 / step) * step; x <= lx2; x += step) {
      const sx = Math.round(toScr(x, 0)[0]) + half;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    for (let y = Math.ceil(ly1 / step) * step; y <= ly2; y += step) {
      const sy = Math.round(toScr(0, y)[1]) + half;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.stroke();
  };
  g(minor, 0.102, 1); // 0.9 grey on white, 1px — as the shader draws it
  g(major, 0.302, 2); // 0.7 grey on white, 2px
}

function finishBox(p) {
  const [x, y] = toScr(p.x, p.y);
  const s = Math.max(FINISH_SIZE * state.z, 5);
  ctx.fillStyle = FINISH_COLOR;
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
}

function startMark(p) {
  const [x, y] = toScr(p.x, p.y);
  const s = Math.max(START_SIZE * state.z, 5);
  ctx.fillStyle = START_COLOR;
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
}

/* ---------- camera ---------- */
export function fit() {
  if (!state.lv) return;
  const b = levelBounds(state.lv);
  const w = Math.max(b.x2 - b.x1, 1),
    h = Math.max(b.y2 - b.y1, 1);
  state.cam = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  setZ(Math.min(state.W / w, state.H / h) * 0.94);
}

/* ax/ay: screen point to keep still while zooming */
export function setZ(nz, ax, ay) {
  nz = Math.max(0.004, Math.min(64, nz));
  if (ax !== undefined) {
    const [lx, ly] = toLvl(ax, ay);
    state.z = nz;
    const [nx, ny] = toLvl(ax, ay);
    state.cam.x += lx - nx;
    state.cam.y += ly - ny;
  } else state.z = nz;
  $("zval").textContent = (state.z * 100 < 10 ? (state.z * 100).toFixed(1) : Math.round(state.z * 100)) + "%";
  draw();
  saveView();
}
