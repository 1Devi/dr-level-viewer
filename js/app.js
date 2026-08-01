import {state} from "./state.js";
import {$, esc} from "./util.js";
import {parseLevel} from "./parse.js";
import {loadSprites} from "./sprites.js";
import {cv, draw, fit, setZ, toLvl, initView} from "./view.js";
import {pickAt} from "./pick.js";
import {renderInfo, renderPick} from "./panel.js";
import {saveView, readHash} from "./hash.js";

/* ---------- loading ---------- */
function load(text, name){
  let parsed;
  try{
    parsed = parseLevel(text);
  }catch(e){
    $("parsewarn").innerHTML = '<p class="note err">Could not parse the file: ' + esc(e.message) + "</p>";
    return;
  }
  state.lv = parsed;
  state.hidden = new Set();
  state.hover = null;
  $("fname").textContent = name;
  $("fname").classList.remove("empty");
  $("note").classList.add("hide");
  const h = readHash();
  if(h){ state.cam = {x: h.x, y: h.y}; setZ(h.z); }
  else fit();
  renderInfo(); renderPick();
}

/* ---------- events ---------- */
$("file").addEventListener("change", e => {
  const f = e.target.files[0];
  if(f) f.text().then(t => load(t, f.name));
});
for(const b of document.querySelectorAll("[data-t]")){
  b.addEventListener("click", () => {
    const k = b.dataset.t;
    state.show[k] = state.show[k] ? 0 : 1;
    b.classList.toggle("on", !!state.show[k]);
    draw();
  });
}
for(const host of [$("groups"), $("objs")]) host.addEventListener("click", e => {
  const b = e.target.closest("[data-g]");
  if(!b) return;
  const k = b.dataset.g;
  state.hidden.has(k) ? state.hidden.delete(k) : state.hidden.add(k);
  b.classList.toggle("off", state.hidden.has(k));
  draw();
});
$("zin").addEventListener("click", () => setZ(state.z*1.4));
$("zout").addEventListener("click", () => setZ(state.z/1.4));
$("zval").addEventListener("click", () => setZ(1));
$("fit").addEventListener("click", fit);
$("png").addEventListener("click", () => {
  if(!state.lv) return;
  const a = document.createElement("a");
  a.download = ($("fname").textContent || "level") + ".png";
  a.href = cv.toDataURL("image/png");
  a.click();
});

cv.addEventListener("wheel", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  setZ(state.z*Math.pow(0.9988, e.deltaY), e.clientX - r.left, e.clientY - r.top);
}, {passive:false});

let drag = null;
cv.addEventListener("pointerdown", e => {
  cv.setPointerCapture(e.pointerId);
  drag = {x: e.clientX, y: e.clientY};
  cv.classList.add("pan");
});
cv.addEventListener("pointermove", e => {
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if(drag){
    state.cam.x -= (e.clientX - drag.x)/state.z;
    state.cam.y -= (e.clientY - drag.y)/state.z;
    drag = {x: e.clientX, y: e.clientY};
    draw(); saveView();
  } else {
    const h = pickAt(sx, sy);
    if(h !== state.hover){ state.hover = h; renderPick(); draw(); }
  }
  if(state.lv){
    const [lx, ly] = toLvl(sx, sy);
    $("mx").textContent = lx.toFixed(1);
    $("my").textContent = ly.toFixed(1);
  }
});
cv.addEventListener("pointerup", () => { drag = null; cv.classList.remove("pan"); });
cv.addEventListener("pointercancel", () => { drag = null; cv.classList.remove("pan"); });
cv.addEventListener("pointerleave", () => {
  if(state.hover){ state.hover = null; renderPick(); draw(); }
  $("mx").textContent = "—"; $("my").textContent = "—";
});

addEventListener("keydown", e => {
  if(e.target && e.target.matches && e.target.matches("input")) return;
  const k = e.key.toLowerCase();
  if(k === "f"){ fit(); }
  else if(k === "g"){ document.querySelector('[data-t="grid"]').click(); }
  else if(k === "+" || k === "="){ setZ(state.z*1.4); }
  else if(k === "-"){ setZ(state.z/1.4); }
  else return;
  e.preventDefault();
});

let dc = 0;
addEventListener("dragenter", e => { e.preventDefault(); dc++; $("drop").classList.add("show"); });
addEventListener("dragover", e => e.preventDefault());
addEventListener("dragleave", e => { if(--dc <= 0){ dc = 0; $("drop").classList.remove("show"); } });
addEventListener("drop", e => {
  e.preventDefault(); dc = 0; $("drop").classList.remove("show");
  const f = e.dataTransfer.files[0];
  if(f) f.text().then(t => load(t, f.name));
});

loadSprites(draw);
initView();
