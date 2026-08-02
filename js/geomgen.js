import { $ } from "./util.js";
import { TYPE, toLines, recordsOf, levelFromShapes, parseShapeJson, exportShapeJson } from "./shapes.js";
import { Geometrizer, averageColor } from "./geometrize.js";
import { writeLevel } from "./write.js";
import { toast } from "./toast.js";

const BUDGET = 14; // ms of work per frame, the rest is the UI's
const WARN_AT = 20000;

let bmp = null,
  srcName = "image";
let px = null; // the working copy of the image
let gz = null; // the running geometrizer, null for imported JSON
let shapes = []; // what we have so far, or what was imported
let running = false,
  raf = 0,
  note = "";
let onLoad = null;

export const isShapeJson = (f) => /\.json$/i.test(f.name || "") || (f.type || "") === "application/json";
export const geomOpen = () => !$("gzwrap").hidden;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (el, a, b, d) => {
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? clamp(v, a, b) : d;
};
const group = (n) => n.toLocaleString("en-US").replace(/,/g, " ");
/* the inner width of an element, padding excluded — the canvas is sized in CSS
   pixels and would otherwise overflow its box by exactly the padding */
function boxWidth(el) {
  const cs = getComputedStyle(el);
  return Math.floor(el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
}

const hex2rgb = (h) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
};

/* ---------- image ---------- */
async function decode(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch (e) {
      /* fall through */
    }
  }
  return await new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      res(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error("could not decode this image"));
    };
    im.src = url;
  });
}

function sample(W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, W, H);
  return { W, H, data: g.getImageData(0, 0, W, H).data };
}

/* ---------- options ---------- */
const TYPE_BOX = [
  ["g_t0", TYPE.RECT],
  ["g_t1", TYPE.ROT_RECT],
  ["g_t2", TYPE.TRIANGLE],
  ["g_t3", TYPE.ELLIPSE],
  ["g_t4", TYPE.ROT_ELLIPSE],
  ["g_t5", TYPE.CIRCLE],
  ["g_t6", TYPE.LINE],
  ["g_t7", TYPE.BEZIER],
];

function types() {
  const t = [];
  for (const [id, v] of TYPE_BOX) if ($(id).checked) t.push(v);
  return t.length ? t : [TYPE.ROT_RECT];
}

const opts = () => ({
  res: Math.round(num($("g_res"), 32, 512, 200)),
  max: Math.round(num($("g_max"), 1, 20000, 300)),
  cand: Math.round(num($("g_cand"), 1, 500, 50)),
  mut: Math.round(num($("g_mut"), 0, 1000, 100)),
  alpha: Math.round(num($("g_alpha"), 1, 255, 128)),
  detail: Math.round(num($("g_detail"), 1, 64, 8)),
  scale: num($("g_scale"), 0.1, 64, 3),
  solid: $("g_layer").value === "solid",
  bgAuto: $("g_bgauto").checked,
  bg: hex2rgb($("g_bg").value),
});

/* ---------- the run ---------- */
function reset() {
  stop();
  shapes = [];
  gz = null;
  if (!bmp) {
    paint();
    return;
  }
  const o = opts();
  const H = Math.max(1, Math.round((o.res * bmp.height) / bmp.width));
  px = sample(o.res, H);
  const bg = o.bgAuto ? averageColor(px) : o.bg;
  if (o.bgAuto) $("g_bg").value = "#" + bg.map((v) => v.toString(16).padStart(2, "0")).join("");
  gz = new Geometrizer(px, { types: types(), candidates: o.cand, mutations: o.mut, alpha: o.alpha, detail: o.detail, bg });
  note = "";
  paint();
}

/* options that only change how the next shapes are chosen are applied live,
   with no need to throw away the ones already found */
function retune() {
  if (!gz) return;
  const o = opts();
  gz.o.types = types();
  gz.o.candidates = o.cand;
  gz.o.mutations = o.mut;
  gz.o.alpha = o.alpha;
}

function frame() {
  raf = 0;
  if (!running || !gz) return;
  const o = opts();
  const t0 = performance.now();
  let stuck = false;
  while (performance.now() - t0 < BUDGET && shapes.length < o.max) {
    const s = gz.step();
    if (!s) {
      stuck = true;
      break;
    } // no shape improves the fit any more
    shapes.push(s);
  }
  paint();
  if (stuck || shapes.length >= o.max) {
    stop();
    toast(stuck ? "stopped · nothing left to improve at " + group(shapes.length) + " shapes" : "geometrized · " + group(shapes.length) + " shapes");
    return;
  }
  raf = requestAnimationFrame(frame);
}

function start() {
  if (!gz || (!shapes.length && !px)) return;
  running = true;
  $("gzrun").textContent = "Pause";
  $("gzrun").classList.add("on");
  if (!raf) raf = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  $("gzrun").textContent = "Run";
  $("gzrun").classList.remove("on");
}

/* ---------- preview ---------- */
/* Drawn as the game draws: a stroke of the line's thickness, round ends only
   where the shape asked for them. What you see is the level. */
function paint() {
  const cv = $("gzpv"),
    g = cv.getContext("2d");
  const w0 = px ? px.W : 200,
    h0 = px ? px.H : 140;
  const wCss = Math.max(140, boxWidth(cv.parentElement));
  const k = Math.min(wCss / w0, 300 / h0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.max(1, Math.round(w0 * k)),
    h = Math.max(1, Math.round(h0 * k));
  cv.style.width = w + "px";
  cv.style.height = h + "px";
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = gz ? gz.bg : hex2rgb($("g_bg").value);
  g.fillStyle = "rgb(" + bg.join(",") + ")";
  g.fillRect(0, 0, w, h);

  g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  const detail = opts().detail;
  for (const s of shapes) {
    const c = s.flat || s.color;
    g.strokeStyle = "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")";
    for (const l of toLines(s, detail)) {
      g.lineWidth = l.th;
      g.lineCap = l.cap ? "round" : "butt";
      g.beginPath();
      g.moveTo(l.x1 + 0.5, l.y1 + 0.5);
      g.lineTo(l.x2 + 0.5, l.y2 + 0.5);
      g.stroke();
    }
  }
  info();
}

function info() {
  const o = opts();
  const n = shapes.length;
  const recs = recordsOf(shapes, o.detail);
  const size = px ? Math.round(px.W * o.scale) + " × " + Math.round(px.H * o.scale) + " units" : "—";
  $("gzinfo").innerHTML = "<b>" + group(n) + "</b> shapes · " + group(recs) + " " + (o.solid ? "lines" : "scenery lines") + (gz ? " · error " + gz.score.toFixed(4) : "") + "<br>" + size + (note ? "<br>" + note : "");

  const has = n > 0;
  for (const id of ["gzgo", "gzdl", "gzjsonsave"]) $(id).disabled = !has;
  $("gzrun").disabled = !gz;
  $("gzwarn").textContent = recs > WARN_AT ? "⚠ " + group(recs) + " records is a lot for the editor" : "";
}

/* ---------- build ---------- */
function build() {
  const o = opts();
  const bg = (gz ? gz.bg : hex2rgb($("g_bg").value)).map((v) => v / 255);
  const lv = levelFromShapes(shapes, { scale: o.scale, solid: o.solid, bg, detail: o.detail });
  const name = ($("g_name").value || "geometrized").trim().replace(/[\\/:*?"<>|]/g, "_") || "geometrized";
  return { lv, out: writeLevel(lv), name };
}

function save(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- entry points ---------- */
export function openGeom() {
  $("gzwrap").hidden = false;
  paint();
}
export function closeGeom() {
  stop();
  $("gzwrap").hidden = true;
}

export async function openImage(file) {
  $("gzwrap").hidden = false;
  $("gzname").textContent = "decoding…";
  try {
    bmp = await decode(file);
  } catch (e) {
    $("gzname").textContent = e.message;
    return;
  }
  srcName = (file.name || "image").replace(/\.[^.]+$/, "");
  $("gzname").textContent = (file.name || "image") + " · " + bmp.width + "×" + bmp.height;
  if (!$("g_name").dataset.touched) $("g_name").value = srcName.slice(0, 40) || "geometrized";
  reset();
  start();
}

export async function openShapeJson(file) {
  $("gzwrap").hidden = false;
  let parsed;
  try {
    parsed = parseShapeJson(await file.text());
  } catch (e) {
    $("gzname").textContent = e.message;
    toast(e.message, true);
    return;
  }
  stop();
  gz = null;
  bmp = null;
  shapes = parsed.shapes;

  // the JSON carries no canvas size, so take it from the shapes themselves
  let W = 1,
    H = 1;
  for (const s of shapes)
    for (const l of toLines(s)) {
      W = Math.max(W, l.x1 + l.th, l.x2 + l.th);
      H = Math.max(H, l.y1 + l.th, l.y2 + l.th);
    }
  px = { W: Math.ceil(W), H: Math.ceil(H), data: null };
  srcName = (file.name || "shapes").replace(/\.[^.]+$/, "");
  $("gzname").textContent = (file.name || "shapes.json") + " · " + shapes.length + " shapes";
  if (!$("g_name").dataset.touched) $("g_name").value = srcName.slice(0, 40) || "geometrized";

  const bits = [];
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  if (parsed.undrawable) bits.push(plural(parsed.undrawable, "shape", "shapes") + " Draw Rider cannot draw, dropped");
  if (parsed.skipped) bits.push(plural(parsed.skipped, "entry", "entries") + " unreadable, skipped");
  note = bits.join(" · ");
  paint();
}

/* ---------- wiring ---------- */
export function initGeom(loadFn) {
  onLoad = loadFn;

  $("gzx").addEventListener("click", closeGeom);
  $("gzwrap").addEventListener("pointerdown", (e) => {
    if (e.target === $("gzwrap")) closeGeom();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && geomOpen()) closeGeom();
  });

  $("gzfile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) openImage(f);
    e.target.value = "";
  });
  $("gzjson").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) openShapeJson(f);
    e.target.value = "";
  });

  $("gzrun").addEventListener("click", () => (running ? stop() : start()));
  $("gzreset").addEventListener("click", () => {
    reset();
  });
  $("g_name").addEventListener("input", () => {
    $("g_name").dataset.touched = "1";
  });

  // these change the target image itself, so the run has to start over
  // detail changes what every shape already found rasterizes to, so it has to
  // start over rather than leave the canvas describing something else
  for (const id of ["g_res", "g_bgauto", "g_bg", "g_detail"])
    $(id).addEventListener("change", () => {
      if (bmp) reset();
      else paint();
    });
  // these only steer what comes next
  for (const id of ["g_cand", "g_mut", "g_alpha"].concat(TYPE_BOX.map((t) => t[0]))) $(id).addEventListener("input", retune);
  for (const id of ["g_scale", "g_layer", "g_max"]) $(id).addEventListener("input", info);

  $("gzgo").addEventListener("click", () => {
    const b = build();
    onLoad(b.out.text, b.name, true);
    closeGeom();
  });
  $("gzdl").addEventListener("click", () => {
    const b = build();
    save(b.name, b.out.text);
    toast("saved · " + group(b.out.nSolid + b.out.nDecor) + " records" + (b.out.guarded ? " · " + b.out.guarded + " moved off x = 1.0" : ""));
  });
  $("gzjsonsave").addEventListener("click", () => {
    save(($("g_name").value || "shapes") + ".json", exportShapeJson(shapes));
    toast("saved " + shapes.length + " shapes as Geometrize JSON");
  });

  addEventListener("resize", () => {
    if (geomOpen()) paint();
  });
  info();
}
