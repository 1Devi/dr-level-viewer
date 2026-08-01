import {state} from "./state.js";
import {$, rgb, hex, nm, esc} from "./util.js";
import {OBJ} from "./format.js";
import {levelBounds, groupsOf} from "./level.js";
import {SPR} from "./sprites.js";

/* the sidebar sections that only change when a new file is loaded or a group
   is toggled */
export function renderInfo(){
  const lv = state.lv;
  if(!lv) return;
  const b = levelBounds(lv);
  const q = (k, v, warn) => "<dt>" + k + "</dt><dd" + (warn ? ' class="q"' : "") + ">" + v + "</dd>";
  $("meta").innerHTML =
    q("editor version", lv.editor ? "d" + esc(lv.editor) : "—") +
    q("vehicle (v)", esc(lv.veh || "—")) +
    q("mode / time (m)", esc((lv.gameMode || "—") + " / " + (lv.bombTime || "—"))) +
    q("background", '<span class="sw" style="background:' + rgb(lv.bg) + '"></span> ' + hex(lv.bg)) +
    q("lines / Z lines", lv.nSolid + " / " + lv.nDecor) +
    q("objects", lv.nObj) +
    q("finish", nm(lv.finish.x) + ", " + nm(lv.finish.y)) +
    q("start", nm(lv.start.x) + ", " + nm(lv.start.y)) +
    q("camera", nm(lv.cam.x) + ", " + nm(lv.cam.y)) +
    q("zoom", '<span title="' + lv.zoom.x + " / " + lv.zoom.y + '">' +
              (+lv.zoom.x.toFixed(5)) + " / " + (+lv.zoom.y.toFixed(5)) + "</span>") +
    q("1st number (ignored)", esc(lv.head)) +
    q("bounds", Math.round(b.x2-b.x1) + " × " + Math.round(b.y2-b.y1));

  const w = [];
  if(lv.warn.length) w.push('<p class="note err">' + lv.warn.map(esc).join("<br>") + "</p>");
  if(lv.skipped.length) w.push('<p class="note">Before the <b>z</b> and <b>c</b> sections the game tries to read an optional number and discards it. This file has some: ' + lv.skipped.map(nm).join(", ") + "</p>");
  $("parsewarn").innerHTML = w.join("");

  $("objs").innerHTML = OBJ.filter(d => lv.objects[d.id].length).map(d =>
    '<button class="grow' + (state.hidden.has("o|" + d.id) ? " off" : "") + '" data-g="o|' + d.id + '">' +
      (d.circle ? '<span class="sw" style="border-radius:50%;background:' + d.circle + '"></span>'
                : '<img class="sw" style="border:0" src="' + SPR[d.spr] + '" alt="">') +
      '<span class="lbl">' + d.label + "</span>" +
      '<span class="n">' + lv.objects[d.id].length + "</span>" +
    "</button>"
  ).join("") || '<span class="muted">no objects</span>';

  const gs = groupsOf(lv);
  $("groups").innerHTML = gs.map(g =>
    '<button class="grow' + (state.hidden.has(g.key) ? " off" : "") + '" data-g="' + g.key + '">' +
      '<span class="sw" style="background:' + rgb(g.c) + '"></span>' +
      '<span class="lbl">' + hex(g.c) + " · w" + g.th + (g.cap !== null ? " · r" + g.cap : "") + "</span>" +
      '<span class="tag' + (g.solid ? " s" : "") + '">' + (g.solid ? "sol" : "dec") + "</span>" +
      '<span class="n">' + g.n + "</span>" +
    "</button>"
  ).join("") || '<span class="muted">no lines</span>';

  $("cnt").textContent = lv.lines.length;
  $("bb").textContent = Math.round(b.x2-b.x1) + "×" + Math.round(b.y2-b.y1);
  $("tail").textContent = lv.tailRaw || "—";
}

/* the "Under cursor" section */
export function renderPick(){
  const el = $("pick");
  const hover = state.hover;
  if(!hover){ el.innerHTML = '<span class="muted">hover a line or object</span>'; return; }
  if(hover.def){
    const {def, o, i} = hover;
    const rows = [
      "<dt>type</dt><dd>" + def.label + " · " + def.hint + "</dd>",
      "<dt>index</dt><dd>" + (i+1) + " of " + state.lv.objects[def.id].length + "</dd>",
      "<dt>position</dt><dd>" + nm(o.x) + ", " + nm(o.y) + "</dd>"
    ];
    if(o.a !== undefined) rows.push("<dt>rotation</dt><dd>" + nm(o.a) + "°</dd>");
    if(o.x2 !== undefined){
      rows.push("<dt>exit</dt><dd>" + nm(o.x2) + ", " + nm(o.y2) + "</dd>");
      rows.push("<dt>exit rotation</dt><dd>" + nm(o.a2) + "°</dd>");
    }
    if(o.t !== undefined) rows.push("<dt>variant (t_t)</dt><dd>" + nm(o.t) + " → way_" + (o.t===1?1:o.t===2?2:0) + ".png</dd>");
    rows.push("<dt>size</dt><dd>" + def.size + "</dd>");
    el.innerHTML = '<dl class="kv">' + rows.join("") + "</dl>" +
      '<pre class="raw" style="margin-top:8px">' + o.raw.map(nm).join("\n") + "</pre>";
    return;
  }
  const l = hover;
  el.innerHTML =
    '<dl class="kv">' +
      "<dt>index</dt><dd>" + l.i + " of " + state.lv.lines.length + "</dd>" +
      "<dt>layer</dt><dd>" + (l.solid ? "solid" : "decor") + "</dd>" +
      "<dt>from</dt><dd>" + nm(l.x1) + ", " + nm(l.y1) + "</dd>" +
      "<dt>to</dt><dd>" + nm(l.x2) + ", " + nm(l.y2) + "</dd>" +
      "<dt>length</dt><dd>" + Math.hypot(l.x2-l.x1, l.y2-l.y1).toFixed(1) + "</dd>" +
      "<dt>width</dt><dd>" + l.th + "</dd>" +
      "<dt>caps</dt><dd>" + (l.cap !== null ? "round r=" + l.cap : "butt") + "</dd>" +
      "<dt>color</dt><dd><span class=\"sw\" style=\"background:" + rgb(l.c) + '"></span> ' + hex(l.c) + "</dd>" +
    "</dl>" +
    '<pre class="raw" style="margin-top:8px"><b>' + esc(l.src[0]) + "</b>\n" + esc(l.src.slice(1).join("\n")) + "</pre>";
}
