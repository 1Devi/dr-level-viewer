import {state} from "./state.js";
import {$, rgb, lum} from "./util.js";
import {OBJ, FINISH_SIZE, FINISH_COLOR, START_SIZE, START_COLOR} from "./format.js";
import {lineKey, levelBounds} from "./level.js";
import {IMG} from "./sprites.js";
import {saveView} from "./hash.js";

export const cv = $("cv");
const ctx = cv.getContext("2d");
const stage = $("stage");

export const toScr = (x, y) => [(x - state.cam.x)*state.z + state.W/2,
                                (y - state.cam.y)*state.z + state.H/2];
export const toLvl = (sx, sy) => [(sx - state.W/2)/state.z + state.cam.x,
                                  (sy - state.H/2)/state.z + state.cam.y];

export function resize(){
  const r = stage.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  state.W = Math.max(1, Math.round(r.width));
  state.H = Math.max(1, Math.round(r.height));
  cv.width = Math.round(state.W*state.dpr);
  cv.height = Math.round(state.H*state.dpr);
  draw();
}

export function initView(){
  new ResizeObserver(resize).observe(stage);
  resize();
}

/* ---------- rendering ---------- */
export function draw(){
  const {lv, show, hidden, hover, W, H, dpr} = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if(!lv){
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--sunk") || "#eee";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  ctx.fillStyle = rgb(lv.bg);
  ctx.fillRect(0, 0, W, H);

  const dark = lum(lv.bg) < 0.45;
  if(show.grid) drawGrid(dark);
  else $("gstep").textContent = "off";

  ctx.lineJoin = "round";
  for(const pass of [false, true]){          // decor first, then solid
    for(const l of lv.lines){
      if(l.solid !== pass) continue;
      if(!(l.solid ? show.solid : show.decor)) continue;
      if(hidden.has(lineKey(l))) continue;
      stroke(l, show.wire);
    }
  }

  if(hover && hover.x1 !== undefined) stroke(hover, true, "#ff0055", 2);

  if(show.obj) drawObjects();
  if(hover && hover.def) hiliteObj(hover);
  if(show.finish) finishBox(lv.finish);
  if(show.start) startMark(lv.start);
}

function drawObjects(){
  const {lv, hidden} = state;
  for(const d of OBJ){
    if(hidden.has("o|" + d.id)) continue;
    for(const o of lv.objects[d.id]){
      if(d.id === "portal"){
        const a = toScr(o.x, o.y), b = toScr(o.x2, o.y2);
        ctx.strokeStyle = "#ff3b30"; ctx.lineWidth = 1; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        sprite(d, "portal", o.x, o.y, o.a);
        sprite(d, "portal_e", o.x2, o.y2, o.a2);
      } else if(d.circle){
        const [x, y] = toScr(o.x, o.y);
        const r = d.size/2*state.z;
        ctx.beginPath(); ctx.arc(x, y, Math.max(r, 1.5), 0, 7);
        ctx.fillStyle = d.circle; ctx.fill();
        if(r > 3){ ctx.lineWidth = Math.max(3*state.z, 1); ctx.strokeStyle = "#aaaaaa"; ctx.stroke(); }
      } else {
        sprite(d, d.id === "way" ? "way_" + (o.t === 1 ? 1 : o.t === 2 ? 2 : 0) : d.spr, o.x, o.y, o.a);
      }
    }
  }
}

function hiliteObj(h){
  const p = h.second ? [h.o.x2, h.o.y2] : [h.o.x, h.o.y];
  const [x, y] = toScr(p[0], p[1]);
  const r = Math.max(h.def.size/2*state.z, 5) + 3;
  ctx.strokeStyle = "#ff0055"; ctx.lineWidth = 2; ctx.lineCap = "butt";
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
}

function sprite(d, name, x, y, ang){
  const im = IMG[name];
  const s = d.size*state.z;
  const [sx, sy] = toScr(x, y);
  if(!im || !im.complete || !im.naturalWidth || s < 2.5){
    // sprite not ready, or the object is smaller than a pixel: draw a dot
    ctx.fillStyle = "#ff3b30";
    ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    return;
  }
  ctx.save();
  ctx.translate(sx, sy);
  if(ang) ctx.rotate(ang*Math.PI/180);
  ctx.drawImage(im, -s/2, -s/2, s, s);
  ctx.restore();
}

function stroke(l, wire, color, extra){
  const [x1, y1] = toScr(l.x1, l.y1), [x2, y2] = toScr(l.x2, l.y2);
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.lineCap = l.cap !== null ? "round" : "butt";
  if(wire){
    ctx.lineWidth = extra || 1.25;
    ctx.strokeStyle = color || (lum(l.c) > 0.5 ? "#000" : "#fff");
    ctx.setLineDash(color ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.lineWidth = Math.max(l.th*state.z, 0.6);
    ctx.strokeStyle = rgb(l.c);
    ctx.stroke();
  }
}

function drawGrid(dark){
  // the editor always draws a 10 and a 100 step; below ~2.5 px the grid merges
  // into a solid wash, so the fine step is dropped there
  const minor = 10, major = 100;
  const {W, H, z} = state;
  const [lx1, ly1] = toLvl(0, 0), [lx2, ly2] = toLvl(W, H);
  const drawn = [];
  const g = (step, alpha, w) => {
    if(step*z < 2.5 || (lx2-lx1)/step > 6000) return;
    drawn.push(step);
    ctx.strokeStyle = "rgba(" + (dark ? "255,255,255," : "0,0,0,") + alpha + ")";
    ctx.lineWidth = w;
    ctx.lineCap = "butt";
    ctx.beginPath();
    for(let x = Math.ceil(lx1/step)*step; x <= lx2; x += step){
      const sx = Math.round(toScr(x, 0)[0]) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    for(let y = Math.ceil(ly1/step)*step; y <= ly2; y += step){
      const sy = Math.round(toScr(0, y)[1]) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(W, sy);
    }
    ctx.stroke();
  };
  // alpha taken from editor screenshots: 229 and 178 on a white background
  g(minor, 0.102, 1);
  g(major, 0.302, 1);
  $("gstep").textContent = drawn.length ? drawn.join(" / ") : "below 1px";
}

function finishBox(p){
  const [x, y] = toScr(p.x, p.y);
  const s = Math.max(FINISH_SIZE*state.z, 5);
  ctx.fillStyle = FINISH_COLOR;
  ctx.fillRect(x - s/2, y - s/2, s, s);
}

function startMark(p){
  const [x, y] = toScr(p.x, p.y);
  const s = Math.max(START_SIZE*state.z, 5);
  ctx.fillStyle = START_COLOR;
  ctx.fillRect(x - s/2, y - s/2, s, s);
}

/* ---------- camera ---------- */
export function fit(){
  if(!state.lv) return;
  const b = levelBounds(state.lv);
  const w = Math.max(b.x2-b.x1, 1), h = Math.max(b.y2-b.y1, 1);
  state.cam = {x: (b.x1+b.x2)/2, y: (b.y1+b.y2)/2};
  setZ(Math.min(state.W/w, state.H/h)*0.94);
}

/* ax/ay: screen point to keep still while zooming */
export function setZ(nz, ax, ay){
  nz = Math.max(0.004, Math.min(64, nz));
  if(ax !== undefined){
    const [lx, ly] = toLvl(ax, ay);
    state.z = nz;
    const [nx, ny] = toLvl(ax, ay);
    state.cam.x += lx - nx; state.cam.y += ly - ny;
  } else state.z = nz;
  $("zval").textContent = (state.z*100 < 10 ? (state.z*100).toFixed(1) : Math.round(state.z*100)) + "%";
  draw();
  saveView();
}
