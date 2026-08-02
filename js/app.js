import { state } from "./state.js";
import { $, esc } from "./util.js";
import { parseLevel } from "./parse.js";
import { loadSprites } from "./sprites.js";
import { cv, draw, fit, setZ, toLvl, initView } from "./view.js";
import { pickAt } from "./pick.js";
import { renderInfo, renderPick } from "./panel.js";
import { saveView, readHash } from "./hash.js";
import { initImageGen, isImageFile, openImage, openGen, genOpen } from "./imggen.js";
import { initGeom, openGeom, geomOpen, openImage as openGeomImage, openShapeJson, isShapeJson } from "./geomgen.js";
import { initAbout, openAbout, aboutOpen } from "./about.js";
import { initEditor, onPointer, onKey, cancelGesture, undo, redo, refreshEditor, resetHistory, newLevelText } from "./editor.js";
import { initMenu, refreshMenu } from "./menu.js";
import { saveLevel, savePng } from "./save.js";
import { toast } from "./toast.js";

/* ---------- loading ---------- */
export function load(text, name, refit) {
  let parsed;
  try {
    parsed = parseLevel(text);
  } catch (e) {
    $("parsewarn").innerHTML = '<p class="note err">Could not parse the file: ' + esc(e.message) + "</p>";
    return;
  }
  state.lv = parsed;
  state.hidden = new Set();
  state.hover = null;
  $("fname").value = name;
  $("note").classList.add("hide");
  const h = refit ? null : readHash();
  if (h) {
    state.cam = { x: h.x, y: h.y };
    setZ(h.z);
  } else fit();
  renderInfo();
  renderPick();
  refreshMenu();
  resetHistory();
  refreshEditor();
}

/* An image opens whichever generator is in front, a .json goes to the
   geometrizer, anything else is read as a level. */
function take(f) {
  if (!f) return;
  if (isShapeJson(f)) openShapeJson(f); // Geometrize shape data
  else if (isImageFile(f)) geomOpen() ? openGeomImage(f) : openImage(f);
  else f.text().then((t) => load(t, f.name));
}

const newLevel = () => {
  load(newLevelText(), "untitled", true);
  toast("new level");
};

/* ---------- events ---------- */
$("file").addEventListener("change", (e) => {
  take(e.target.files[0]);
  e.target.value = "";
});
for (const b of document.querySelectorAll("[data-t]")) {
  b.addEventListener("click", () => {
    const k = b.dataset.t;
    state.show[k] = state.show[k] ? 0 : 1;
    b.classList.toggle("on", !!state.show[k]);
    if (k === "grid") refreshEditor();
    draw();
  });
}
for (const host of [$("groups"), $("objs")])
  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]");
    if (!b) return;
    const k = b.dataset.g;
    state.hidden.has(k) ? state.hidden.delete(k) : state.hidden.add(k);
    b.classList.toggle("off", state.hidden.has(k));
    draw();
  });
initMenu({
  open: () => $("file").click(),
  image: openGen,
  geom: openGeom,
  save: saveLevel,
  png: savePng,
  about: openAbout,
  new: newLevel,
});

$("zin").addEventListener("click", () => setZ(state.z * 1.4));
$("zout").addEventListener("click", () => setZ(state.z / 1.4));
$("zval").addEventListener("click", () => setZ(1));
$("fit").addEventListener("click", fit);

cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    setZ(state.z * Math.pow(0.9988, e.deltaY), e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);

let drag = null;
const at = (e) => {
  const r = cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

cv.addEventListener("pointerdown", (e) => {
  const [sx, sy] = at(e);
  cv.setPointerCapture(e.pointerId);
  const [lx, ly] = toLvl(sx, sy);
  if (onPointer("down", lx, ly, e.shiftKey)) return; // a tool took the gesture
  drag = { x: e.clientX, y: e.clientY };
  cv.classList.add("pan");
});
cv.addEventListener("pointermove", (e) => {
  const [sx, sy] = at(e);
  if (state.lv) {
    const [lx, ly] = toLvl(sx, sy);
    $("mx").textContent = lx.toFixed(1);
    $("my").textContent = ly.toFixed(1);
    if (onPointer("move", lx, ly, e.shiftKey)) return;
  }
  if (drag) {
    state.cam.x -= (e.clientX - drag.x) / state.z;
    state.cam.y -= (e.clientY - drag.y) / state.z;
    drag = { x: e.clientX, y: e.clientY };
    draw();
    saveView();
  } else {
    const h = pickAt(sx, sy);
    if (h !== state.hover) {
      state.hover = h;
      renderPick();
      draw();
    }
  }
});
cv.addEventListener("pointerup", (e) => {
  const [sx, sy] = at(e);
  const [lx, ly] = toLvl(sx, sy);
  if (state.lv) onPointer("up", lx, ly, e.shiftKey);
  drag = null;
  cv.classList.remove("pan");
});
cv.addEventListener("pointercancel", () => {
  drag = null;
  cv.classList.remove("pan");
});
cv.addEventListener("pointerleave", () => {
  if (state.hover) {
    state.hover = null;
    renderPick();
    draw();
  }
  $("mx").textContent = "—";
  $("my").textContent = "—";
});

const toggleGrid = () => document.querySelector('[data-t="grid"]').click();

addEventListener("keydown", (e) => {
  const open = genOpen() || geomOpen() || aboutOpen();
  if (e.key === "Escape" && cancelGesture()) {
    e.preventDefault();
    return;
  }
  if (e.key === "F1") {
    // Chrome opens its help page on F1; taking the key back may not be allowed
    // everywhere, in which case this simply does nothing extra
    if (!open) openAbout();
    e.preventDefault();
    return;
  }
  if (open) return;
  if (e.target && e.target.matches && e.target.matches("input, select, textarea")) return;
  // a caret on the level swallows ordinary keys; Ctrl combinations still pass
  if (onKey(e)) {
    e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();

  if (e.ctrlKey || e.metaKey) {
    // each of these is a key the browser wants for itself — save, open, print,
    // find, find-next, page zoom — so the branch takes it back. Ctrl+F and
    // Ctrl+G are not reliably ours, which is why fit and grid also answer to
    // the bare letters below.
    if (k === "z") {
      e.shiftKey ? redo() : undo();
    } else if (k === "y") {
      redo();
    } else if (k === "s") {
      e.shiftKey ? savePng() : saveLevel();
    } else if (k === "o") {
      $("file").click();
    } else if (k === "p") {
      openGen();
    } else if (k === "g") {
      e.shiftKey ? openGeom() : toggleGrid();
    } else if (k === "f") {
      fit();
    } else if (k === "=" || k === "+") {
      setZ(state.z * 1.4);
    } else if (k === "-" || k === "_") {
      setZ(state.z / 1.4);
    } else return;
    e.preventDefault();
    return;
  }

  if (k === "f") {
    fit();
  } else if (k === "g") {
    toggleGrid();
  } else if (k === "n") {
    newLevel();
  } else return;
  e.preventDefault();
});

/* no browser context menu anywhere on the page */
addEventListener("contextmenu", (e) => e.preventDefault());

let dc = 0;
addEventListener("dragenter", (e) => {
  e.preventDefault();
  dc++;
  $("drop").classList.add("show");
});
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("dragleave", (e) => {
  if (--dc <= 0) {
    dc = 0;
    $("drop").classList.remove("show");
  }
});
addEventListener("drop", (e) => {
  e.preventDefault();
  dc = 0;
  $("drop").classList.remove("show");
  take(e.dataTransfer.files[0]);
});

loadSprites(draw);
initImageGen(load);
initAbout();
initEditor(draw, renderInfo);
initGeom(load);
initView();
