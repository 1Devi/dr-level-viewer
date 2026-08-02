/* =====================================================================
   IMAGE -> LEVEL, the browser part.

   Picks a JPG/PNG, samples it down to a small RGBA grid, shows what the
   result will look like, then hands the grid to pixels.js / write.js and
   drops the finished level straight into the viewer.

   Nothing leaves the machine: the file is decoded locally, exactly like a
   level file is.
   ===================================================================== */

import { $ } from "./util.js";
import { DEFAULTS, levelFromPixels } from "./pixels.js";
import { writeLevel } from "./write.js";

const MAX_W = 512; // sane ceiling: 512 wide is already ~175k pixels
const WARN_AT = 40000; // records above this take a while to save in the editor
const HARD_AT = 120000;

let bmp = null; // ImageBitmap or HTMLImageElement
let srcName = "image";
let onLoad = null; // the viewer's load(text, name, refit)
let cache = null; // {key, px} — sampling is the slow bit, keep the last one
let last = null; // {lv, px, opt} of the current preview
let timer = 0;

/* ---------- helpers ---------- */
export const isImageFile = (f) => /^image\//.test(f.type || "") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name || "");

export const genOpen = () => !$("genwrap").hidden;

const hex2rgb = (h) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
};
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

/* ---------- decoding and sampling ---------- */
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

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/* Straight drawImage to a tiny size point-samples in some browsers and drops
   thin detail, so halve step by step while smoothing is on. */
function sample(W, H, smooth) {
  const key = W + "|" + H + "|" + (smooth ? 1 : 0);
  if (cache && cache.key === key) return cache.px;

  let src = bmp,
    sw = bmp.width,
    sh = bmp.height;
  if (smooth) {
    while (sw > W * 2 && sh > H * 2) {
      const c = canvasOf(Math.max(W, sw >> 1), Math.max(H, sh >> 1));
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, c.width, c.height);
      src = c;
      sw = c.width;
      sh = c.height;
    }
  }
  const c = canvasOf(W, H);
  const g = c.getContext("2d", { willReadFrequently: true });
  // upscaling a small icon: smoothing would only blur it, keep the hard pixels
  g.imageSmoothingEnabled = !!smooth && sw > W;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, W, H);
  const px = { W, H, data: g.getImageData(0, 0, W, H).data };
  cache = { key, px };
  return px;
}

/* ---------- options ---------- */
function readOpts() {
  const W = Math.round(num($("o_w"), 2, MAX_W, DEFAULTS.width));
  return {
    W,
    smooth: $("o_smooth").checked,
    size: Math.round(num($("o_s"), 1, 64, DEFAULTS.size)),
    solid: $("o_layer").value === "solid",
    alpha: Math.round(num($("o_a"), 0, 255, DEFAULTS.alpha)),
    post: Math.round(num($("o_p"), 0, 32, 0)),
    merge: $("o_merge").checked,
    skipBg: $("o_skip").checked,
    key: hex2rgb($("o_key").value),
    tol: Math.round(num($("o_tol"), 0, 255, DEFAULTS.tol)),
    bg: hex2rgb($("o_bg").value).map((v) => v / 255),
    ox: DEFAULTS.ox,
    oy: DEFAULTS.oy,
  };
}

/* ---------- preview ---------- */
/* Drawn from the records themselves, so what is on screen is exactly what
   goes into the file — dropped pixels included. */
function paint(px, recs, opt) {
  const cv = $("genpv"),
    g = cv.getContext("2d");
  const wCss = Math.max(120, boxWidth(cv.parentElement));
  const scale = Math.min(wCss / px.W, 260 / px.H, 24);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.max(1, Math.round(px.W * scale)),
    h = Math.max(1, Math.round(px.H * scale));
  cv.style.width = w + "px";
  cv.style.height = h + "px";
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);

  const grid = canvasOf(px.W, px.H);
  const gg = grid.getContext("2d");
  const im = gg.createImageData(px.W, px.H);
  const S = opt.size;
  for (const r of recs) {
    const gx = Math.round((r.x1 - opt.ox) / S);
    const gy = Math.round((r.y1 - opt.oy - S / 2) / S);
    const n = Math.max(1, Math.round((r.x2 - r.x1) / S));
    for (let k = 0; k < n; k++) {
      const i = (gy * px.W + gx + k) * 4;
      im.data[i] = Math.round(r.c[0] * 255);
      im.data[i + 1] = Math.round(r.c[1] * 255);
      im.data[i + 2] = Math.round(r.c[2] * 255);
      im.data[i + 3] = 255;
    }
  }
  gg.putImageData(im, 0, 0);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgb(" + opt.bg.map((v) => Math.round(v * 255)).join(",") + ")";
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = false;
  g.drawImage(grid, 0, 0, w, h);
}

function refresh() {
  const ready = !!bmp;
  $("gengo").disabled = $("gendl").disabled = !ready;
  if (!ready) {
    $("geninfo").textContent = "choose a PNG or JPG";
    return;
  }

  const opt = readOpts();
  const H = Math.max(1, Math.round((opt.W * bmp.height) / bmp.width));
  const px = sample(opt.W, H, opt.smooth);
  const lv = levelFromPixels(px, opt);
  last = { lv, px, opt };

  paint(px, lv.lines, opt);

  const n = lv.lines.length;
  const rows = 3 + 4 * n + 24;
  const kb = Math.round((rows * 10) / 1024);
  $("geninfo").innerHTML = px.W + " × " + px.H + " px · <b>" + group(n) + "</b> " + (opt.solid ? "lines" : "scenery lines") + " · " + group(rows) + " rows · ≈" + kb + " KB<br>" + "level size " + px.W * opt.size + " × " + px.H * opt.size + " units";

  let w = "";
  if (n > HARD_AT) w = "⚠ " + group(n) + " records — the editor will crawl, try a smaller width";
  else if (n > WARN_AT) w = "⚠ " + group(n) + " records — heavy, but it opens";
  $("genwarn").textContent = w;
  $("genwarn").className = "genwarn" + (n > HARD_AT ? " bad" : "");
}

const soon = () => {
  clearTimeout(timer);
  timer = setTimeout(refresh, 90);
};

/* ---------- build ---------- */
function build() {
  if (!last) return null;
  const lv = levelFromPixels(last.px, last.opt); // fresh records: the guard mutates them
  const out = writeLevel(lv);
  const name = ($("o_name").value || "pixels").trim().replace(/[\\/:*?"<>|]/g, "_") || "pixels";
  return { text: out.text, name, out };
}

/* ---------- modal ---------- */
export function openGen() {
  $("genwrap").hidden = false;
  refresh();
}
export function closeGen() {
  $("genwrap").hidden = true;
}

export async function openImage(file) {
  $("genwrap").hidden = false;
  $("genname").textContent = "decoding…";
  try {
    bmp = await decode(file);
  } catch (e) {
    $("genname").textContent = e.message;
    return;
  }
  cache = null;
  srcName = (file.name || "image").replace(/\.[^.]+$/, "");
  $("genname").textContent = (file.name || "image") + " · " + bmp.width + "×" + bmp.height;
  if (!$("o_name").dataset.touched) $("o_name").value = srcName.slice(0, 40) || "pixels";
  refresh();
}

export function initImageGen(loadFn) {
  onLoad = loadFn;

  // opening the generator is a menu action now, see js/menu.js
  $("genx").addEventListener("click", closeGen);
  $("genwrap").addEventListener("pointerdown", (e) => {
    if (e.target === $("genwrap")) closeGen();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && genOpen()) closeGen();
  });

  $("genfile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) openImage(f);
    e.target.value = "";
  });

  // width: the number box and the slider drive each other
  $("o_wr").addEventListener("input", () => {
    $("o_w").value = $("o_wr").value;
    soon();
  });
  $("o_w").addEventListener("input", () => {
    $("o_wr").value = clamp(parseFloat($("o_w").value) || 2, 2, MAX_W);
    soon();
  });
  $("o_name").addEventListener("input", () => {
    $("o_name").dataset.touched = "1";
  });
  for (const id of ["o_s", "o_layer", "o_a", "o_p", "o_bg", "o_skip", "o_key", "o_tol", "o_smooth", "o_merge"]) $(id).addEventListener("input", soon);

  // pick the colour to drop straight off the preview
  $("genpv").addEventListener("click", (e) => {
    if (!last) return;
    const r = $("genpv").getBoundingClientRect();
    const gx = Math.floor(((e.clientX - r.left) / r.width) * last.px.W);
    const gy = Math.floor(((e.clientY - r.top) / r.height) * last.px.H);
    const i = (gy * last.px.W + gx) * 4,
      d = last.px.data;
    if (i < 0 || i >= d.length) return;
    $("o_key").value = "#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    $("o_skip").checked = true;
    refresh();
  });

  $("gengo").addEventListener("click", () => {
    const b = build();
    if (!b) return;
    onLoad(b.text, b.name, true);
    closeGen();
  });

  $("gendl").addEventListener("click", () => {
    const b = build();
    if (!b) return;
    // octet-stream, or the browser appends .txt to a name that has no extension
    const url = URL.createObjectURL(new Blob([b.text], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = b.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  addEventListener("resize", () => {
    if (genOpen()) soon();
  });
}
