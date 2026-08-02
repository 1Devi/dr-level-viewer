import { state } from "./state.js";
import { $, hex, esc, nm } from "./util.js";
import { segDist } from "./level.js";
import { OBJ, byId } from "./format.js";
import { SPR } from "./sprites.js";
import { writeLevel } from "./write.js";
import { ICON } from "./icons.js";
import { textToLines, metrics, hitText, textBox, loadFontFile, DEFAULT_FAMILY } from "./text.js";
import { toast } from "./toast.js";

/* =====================================================================
   LEVEL EDITOR

   Tools, named after the game's own (the strings live in resource.car):

     move and zoom · lines · brush · pencil · eraser · pipette · object
     choose · start · finish

   Lines and scenery lines are one tool with a `scenery` switch, and so are
   brush and scenery brush — the geometry is identical, only the layer differs.

   Everything edits state.lv in place, the object the parser produced and the
   writer consumes, so an edited level saves through exactly the path a loaded
   one does.
   ===================================================================== */

export const TOOLS = [
  { id: "move", icon: "move", label: "move and zoom" },
  { id: "line", icon: "line", label: "lines", draw: 1 },
  { id: "brush", icon: "brush", label: "brush", draw: 1, curve: 1 },
  { id: "pencil", icon: "pencil", label: "pencil", free: 1 },
  { id: "eraser", icon: "eraser", label: "eraser" },
  { id: "pipette", icon: "pipette", label: "pipette" },
  { id: "object", icon: "object", label: "object" },
  { id: "choose", icon: "choose", label: "choose" },
  { id: "text", icon: "text", label: "text" },
  { id: "start", icon: "start", label: "start" },
  { id: "finish", icon: "finish", label: "finish" },
];
const byTool = {};
for (const t of TOOLS) byTool[t.id] = t;

export const VEHICLES = ["Bicycle", "Motorcycle", "ATV", "Sled", "Scooter", "Segway", "Mini bike", "Hoverboard", "Monster"];

/* The three modes the editor offers, with the values the shipped levels use.
   `m 0` is everywhere; `m 1` sits on levels called Tricpo, Triko, Rearti,
   Migatriso, Super jump — tricks; `m 2` on Ohoho, Forohno, Ouchohu, Slipohna,
   Porcubohu — the "oh no" set, and that is the branch in the editor's own code
   that removes the rider's group and hides the vehicle icon.

   The second number is the bomb timer in the ordinary mode, and on trick
   levels it runs 10 to 50, which reads as the target rather than a fuse. */
export const MODES = [
  { v: "0", label: "normal · on time" },
  { v: "1", label: "tricks · on score" },
  { v: "2", label: "oh no · no vehicle" },
];

const SEGMENTS = 18; // pieces a curve is drawn with
const GRAB = 4,
  GRAB_MAX = 12;
const MERGE_MS = 700; // edits closer together than this count as one

let redraw = null,
  reinfo = null;
let drag = null,
  bend = null,
  placing = null;
let typing = null; // {x, y, rows} while a caret is on the level
let lastEnd = null; // where the last stroke finished, for the magnet
const undoLog = [],
  redoLog = [];

export const tool = () => byTool[state.tool] || byTool.move;

/* ---------------------------------------------------------------------
   records, shaped exactly like the parser's own
   --------------------------------------------------------------------- */
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const round1 = (v) => Math.round(v * 10) / 10;

/* The grid the game's editor draws, and the step it puts points on: levels
   drawn in it have 89.6% of object coordinates and half of all line ends on
   multiples of ten, and nothing on twenty. With the grid switched on, every
   point a tool puts down lands on it. */
const GRID = 10;
const onGrid = () => !!state.show.grid;
const snap = (v) => (onGrid() ? Math.round(v / GRID) * GRID : round1(v));
/* moving something keeps its shape: the step is snapped, not the ends */
const snapBy = (d) => (onGrid() ? Math.round(d / GRID) * GRID : round1(d));
const deg = (a) => Math.round(((a % 360) + 360) % 360);

function srcOf(l) {
  let head = f1(l.x1) + " " + f2(l.c[0]) + " " + f2(l.c[1]) + " " + f2(l.c[2]) + " " + l.th;
  if (l.cap) head += " " + l.cap;
  return [head, f1(l.y1), f1(l.x2), f1(l.y2)];
}

/* the colour of the layer being drawn into */
const inkOf = (e) => (e.scenery ? e.cz : e.c);

function mkLine(x1, y1, x2, y2) {
  const e = state.ed;
  const l = {
    i: 0,
    solid: !e.scenery,
    x1,
    y1,
    x2,
    y2,
    c: inkOf(e).slice(),
    th: e.th,
    cap: e.round ? Math.max(1, Math.round(e.th / 2)) : null,
  };
  l.src = srcOf(l);
  return l;
}

/* The file keeps coordinates to a tenth, so anything shorter than that has no
   length once written. With butt ends such a record draws nothing at all and is
   pure litter; with round ends it is a dot, which is a thing people draw on
   purpose — the game's own levels hold 42 of them. */
const drawable = (l) => l.cap !== null || Math.hypot(l.x2 - l.x1, l.y2 - l.y1) >= 0.05;

/* solid lines come first in the file, and so they do in the model */
function reindex() {
  const lv = state.lv;
  lv.lines.sort((a, b) => (a.solid === b.solid ? 0 : a.solid ? -1 : 1));
  lv.nSolid = 0;
  lv.nDecor = 0;
  for (let i = 0; i < lv.lines.length; i++) {
    lv.lines[i].i = i;
    lv.lines[i].solid ? lv.nSolid++ : lv.nDecor++;
  }
  lv.nObj = 0;
  for (const d of OBJ) lv.nObj += lv.objects[d.id].length;
}

/* ---------------------------------------------------------------------
   undo — commands, not snapshots: a level holds tens of thousands of lines
   and copying them all per stroke costs more than the drawing does
   --------------------------------------------------------------------- */
const snapOf = (kind, x) => (kind === "line" ? { x1: x.x1, y1: x.y1, x2: x.x2, y2: x.y2, c: x.c.slice(), th: x.th, cap: x.cap } : { x: x.x, y: x.y, a: x.a, x2: x.x2, y2: x.y2, a2: x.a2, t: x.t, raw: x.raw.slice(), extra: x.extra ? JSON.parse(JSON.stringify(x.extra)) : undefined });

function put(kind, target, s) {
  Object.assign(target, s);
  if (kind === "line") {
    target.c = s.c.slice();
    target.src = srcOf(target);
  } else target.raw = s.raw.slice();
}

function commit(cmd) {
  if (cmd.t === "add") {
    cmd.lines = cmd.lines.filter(drawable);
    if (!cmd.lines.length) {
      after();
      return;
    }
  }
  // a field held down or an object dragged across the screen is one change, not
  // fifty: fold it into the entry on top when it is the same field of the same
  // thing, moments apart. Different fields stay separate, so undo walks back
  // the way the edits were made.
  const top = undoLog[undoLog.length - 1];
  const same = top && top.t === cmd.t && top.tag === cmd.tag && Date.now() - top.at < MERGE_MS && (cmd.t === "edit" ? top.target === cmd.target : cmd.t === "edits" && top.items.length === cmd.items.length && top.items.every((it, k) => it.target === cmd.items[k].target));
  if (same) {
    top.at = Date.now();
    if (cmd.t === "edit") {
      top.after = cmd.after;
      put(cmd.kind, cmd.target, cmd.after);
    } else
      for (let k = 0; k < cmd.items.length; k++) {
        top.items[k].after = cmd.items[k].after;
        put(cmd.items[k].kind, cmd.items[k].target, cmd.items[k].after);
      }
    reindex();
    after();
    return;
  }
  if (cmd.t === "edit" || cmd.t === "edits") cmd.at = Date.now();
  undoLog.push(cmd);
  if (undoLog.length > 200) undoLog.shift();
  redoLog.length = 0;
  apply(cmd, false);
}

function apply(cmd, back) {
  const lv = state.lv;
  const drop = (arr, items) => {
    for (const x of items) {
      const k = arr.indexOf(x);
      if (k >= 0) arr.splice(k, 1);
    }
  };

  if (cmd.t === "add") back ? drop(lv.lines, cmd.lines) : lv.lines.push(...cmd.lines);
  else if (cmd.t === "del") back ? lv.lines.push(...cmd.lines) : drop(lv.lines, cmd.lines);
  else if (cmd.t === "obj") {
    for (const it of cmd.items) {
      const arr = lv.objects[it.id];
      cmd.remove === !back ? drop(arr, [it.o]) : arr.push(it.o);
    }
  } else if (cmd.t === "edit") put(cmd.kind, cmd.target, back ? cmd.before : cmd.after);
  else if (cmd.t === "edits") for (const it of cmd.items) put(it.kind, it.target, back ? it.before : it.after);
  else if (cmd.t === "set") {
    const v = back ? cmd.before : cmd.after;
    if (cmd.key === "veh") lv.veh = v;
    else if (cmd.key === "bg") lv.bg = v.slice();
    else if (cmd.key === "mode") {
      lv.gameMode = v.m;
      lv.bombTime = v.b;
    } else lv[cmd.key] = { x: v.x, y: v.y };
  }
  reindex();
  after();
}

export function undo() {
  const cmd = undoLog.pop();
  if (!cmd) {
    toast("nothing to undo");
    return;
  }
  redoLog.push(cmd);
  apply(cmd, true);
}

export function redo() {
  const cmd = redoLog.pop();
  if (!cmd) return;
  undoLog.push(cmd);
  apply(cmd, false);
}

function after() {
  state.ghost = null;
  if (reinfo) reinfo();
  if (redraw) redraw();
  refreshEditor();
}

/* ---------------------------------------------------------------------
   picking
   --------------------------------------------------------------------- */
const slack = () => Math.min(GRAB / state.z, GRAB_MAX);

function lineAt(mx, my, extra) {
  const lv = state.lv;
  for (let k = lv.lines.length - 1; k >= 0; k--) {
    const l = lv.lines[k];
    if (segDist(mx, my, l) <= l.th / 2 + (extra === undefined ? slack() : extra)) return l;
  }
  return null;
}

function objectsAt(mx, my, extra) {
  const out = [];
  for (const d of OBJ)
    for (const o of state.lv.objects[d.id]) {
      const r = d.size / 2 + extra;
      if (Math.hypot(o.x - mx, o.y - my) <= r) out.push({ kind: "obj", id: d.id, o, second: false });
      else if (o.x2 !== undefined && Math.hypot(o.x2 - mx, o.y2 - my) <= r) out.push({ kind: "obj", id: d.id, o, second: true });
    }
  return out;
}

/* ---------------------------------------------------------------------
   objects
   --------------------------------------------------------------------- */
function mkObject(def, x, y, rot) {
  const o = { x, y, raw: [x, y] };
  if (def.fields >= 3) {
    o.a = rot;
    o.raw.push(rot);
  }
  if (def.id === "portal") {
    o.x2 = x;
    o.y2 = y;
    o.a2 = rot;
    o.raw = [x, y, rot, x, y, rot];
    o.half = true; // the exit is not a real one yet
  }
  if (def.id === "way") {
    o.t = state.ed.wayT;
    o.raw = [x, y, rot, state.ed.wayT];
  }
  if (def.id === "portal" && state.ed.alt) setAlt(o, true);
  return o;
}

/* A portal comes in two looks. The second one is marked by an extra number on
   the same row as x2 — the same trick a line uses for its rounding — and the
   game then draws it with its other pair of sprites, portal_editor and
   portal_e_editor. It is a switch, not an amount: the files the game writes
   carry either nothing there or a 1. */
export const altPortal = (o) => !!(o.extra && o.extra[3] && o.extra[3][0]);

function setAlt(o, on) {
  o.extra = Object.assign({}, o.extra);
  if (on) o.extra[3] = [1];
  else delete o.extra[3];
}

/* angle and position live in two places at once — the fields the viewer reads
   and the raw numbers the writer prefers — so they are always set together */
function setAngle(id, o, second, a) {
  const def = byId[id];
  if (def.fields < 3) return;
  if (second) {
    o.a2 = a;
    o.raw[5] = a;
  } else {
    o.a = a;
    o.raw[2] = a;
  }
}

function setPos(id, o, second, x, y) {
  if (second) {
    o.x2 = x;
    o.y2 = y;
    o.raw[3] = x;
    o.raw[4] = y;
  } else {
    o.x = x;
    o.y = y;
    o.raw[0] = x;
    o.raw[1] = y;
  }
}

/* ---------------------------------------------------------------------
   pointer

   kind: "down" | "move" | "up", in level coordinates.
   -> true when a tool took the gesture and the viewer should stay out of it
   --------------------------------------------------------------------- */
export function onPointer(kind, mx, my, shiftKey) {
  if (!state.lv) return false;
  const t = tool();
  const e = state.ed;

  if (t.id === "eraser") {
    state.eraseAt = kind === "up" ? null : { x: mx, y: my, r: e.eraseR };
    if (redraw) redraw();
  } else if (state.eraseAt) {
    state.eraseAt = null;
    if (redraw) redraw();
  }

  // a curve waiting to be bent follows the pointer until it is clicked
  if (bend) {
    if (kind === "move") {
      bend.off = [snap(mx) - (bend.a[0] + bend.b[0]) / 2, snap(my) - (bend.a[1] + bend.b[1]) / 2];
      state.ghost = curveLines(bend.a, bend.b, bend.off);
      if (redraw) redraw();
    } else if (kind === "down") {
      const lines = curveLines(bend.a, bend.b, bend.off);
      const b = bend.b;
      bend = null;
      lastEnd = b;
      commit({ t: "add", lines });
    }
    return true;
  }

  if (t.id === "move") return false;

  /* ---- drawing ---- */
  if (t.draw) {
    if (kind === "down") {
      // the magnet is the whole of the snapping there is: a new stroke starts
      // where the last one ended, so a chain closes with no hairline gap
      drag = { a: e.magnet && lastEnd ? lastEnd.slice() : [snap(mx), snap(my)] };
      return true;
    }
    if (!drag) return true;
    const b = [snap(mx), snap(my)];
    if (kind === "move") {
      state.ghost = t.curve ? curveLines(drag.a, b, [0, 0]) : [mkLine(drag.a[0], drag.a[1], b[0], b[1])];
      if (redraw) redraw();
      return true;
    }
    const a = drag.a;
    drag = null;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) {
      state.ghost = null;
      if (redraw) redraw();
      return true;
    }
    if (t.curve) {
      bend = { a, b, off: [0, 0] }; // second half of the gesture
      state.ghost = curveLines(a, b, [0, 0]);
      if (redraw) redraw();
      return true;
    }
    lastEnd = b;
    commit({ t: "add", lines: [mkLine(a[0], a[1], b[0], b[1])] });
    return true;
  }

  /* ---- pencil: free-hand, a segment laid every `seg` units ---- */
  if (t.free) {
    if (kind === "down") {
      drag = { pts: [[snap(mx), snap(my)]], lines: [] };
      state.ghost = [];
      return true;
    }
    if (!drag) return true;
    if (kind === "move") {
      const last = drag.pts[drag.pts.length - 1];
      const step = Math.max(0.1, e.seg);
      // with the grid on every point lands on a node, staircase and all
      if (Math.hypot(mx - last[0], my - last[1]) < step) return true;
      const p = [snap(mx), snap(my)];
      if (p[0] === last[0] && p[1] === last[1]) return true;
      drag.pts.push(p);
      drag.lines.push(mkLine(last[0], last[1], p[0], p[1]));
      state.ghost = drag.lines.slice();
      if (redraw) redraw();
      return true;
    }
    /* the tail is shorter than a segment, but dropping it would mean a quick
       flick draws nothing at all */
    const last = drag.pts[drag.pts.length - 1];
    const end = [snap(mx), snap(my)];
    if (end[0] !== last[0] || end[1] !== last[1]) drag.lines.push(mkLine(last[0], last[1], end[0], end[1]));

    const lines = drag.lines;
    lastEnd = end;
    drag = null;
    state.ghost = null;
    if (!lines.length) {
      if (redraw) redraw();
      return true;
    }
    commit({ t: "add", lines });
    return true;
  }

  /* ---- eraser ---- */
  if (t.id === "eraser") {
    if (kind === "down") drag = { lines: [], objs: [] };
    if (!drag) return true;
    if (kind === "up") {
      const got = drag;
      drag = null;
      if (got.lines.length) {
        state.lv.lines.push(...got.lines); // put them back: commit does the removing
        commit({ t: "del", lines: got.lines });
      }
      if (got.objs.length) {
        for (const it of got.objs) state.lv.objects[it.id].push(it.o);
        commit({ t: "obj", remove: true, items: got.objs });
      }
      return true;
    }
    let touched = false;
    for (let n = 0; n < 40; n++) {
      // a fast drag can cross several
      const l = lineAt(mx, my, e.eraseR);
      if (!l) break;
      drag.lines.push(l);
      state.lv.lines.splice(state.lv.lines.indexOf(l), 1);
      touched = true;
    }
    for (const it of objectsAt(mx, my, e.eraseR)) {
      const arr = state.lv.objects[it.id];
      if (arr.indexOf(it.o) < 0) continue;
      arr.splice(arr.indexOf(it.o), 1);
      drag.objs.push(it);
      touched = true;
    }
    if (touched) {
      reindex();
      if (reinfo) reinfo();
      if (redraw) redraw();
    }
    return true;
  }

  /* ---- object: placed on press, turned while the button is still down ---- */
  if (t.id === "object") {
    const def = byId[e.obj] || byId.turbo;
    if (kind === "down") {
      const x = snap(mx),
        y = snap(my);
      if (placing && placing.stage === 1) {
        // the far end of a portal
        delete placing.o.half;
        setPos(placing.id, placing.o, true, x, y);
        placing.anchor = [x, y];
      } else {
        const o = mkObject(def, x, y, e.rot);
        state.lv.objects[def.id].push(o); // live, so it draws while it turns
        placing = { id: def.id, o, stage: 0, anchor: [x, y] };
      }
      reindex();
      if (redraw) redraw();
      return true;
    }
    if (!placing) return true;
    if (kind === "move") {
      if (!rotates(placing.id)) return true; // nothing to turn on this one
      const dx = mx - placing.anchor[0],
        dy = my - placing.anchor[1];
      if (Math.hypot(dx, dy) > 3 / state.z) {
        const a = deg((Math.atan2(dy, dx) * 180) / Math.PI);
        setAngle(placing.id, placing.o, placing.stage === 1, a);
        e.rot = a;
        if (redraw) redraw();
        refreshEditor();
      }
      return true;
    }
    // up
    if (placing.id === "portal" && placing.stage === 0) {
      placing.stage = 1;
      toast("now press where it comes out, and turn it the same way");
      return true;
    }
    const o = placing.o,
      id = placing.id;
    delete o.half;
    placing = null;
    state.lv.objects[id].splice(state.lv.objects[id].indexOf(o), 1);
    commit({ t: "obj", remove: false, items: [{ id, o }] });
    return true;
  }

  /* ---- choose: pick something, drag it, edit it in the panel ---- */
  if (t.id === "choose") {
    if (kind === "down") {
      const hits = objectsAt(mx, my, slack());
      const onObj = hits.length ? hits[hits.length - 1] : null;
      const onLine = onObj ? null : lineAt(mx, my);

      /* Shift builds up a set, and only out of lines. An object is a single
         thing with its own properties, so it never joins a set and nothing
         joins it — clicking one with shift held simply leaves the selection
         alone rather than quietly swapping it. */
      if (shiftKey) {
        if (!onLine || (state.sel && state.sel.kind === "obj")) return true;
        const list = state.sel && state.sel.kind === "lines" ? state.sel.list.slice() : [];
        const k = list.indexOf(onLine);
        k >= 0 ? list.splice(k, 1) : list.push(onLine);
        state.sel = list.length ? { kind: "lines", list } : null;
        drag = null;
        after();
        return true;
      }

      // clicking something already in the set keeps the set and drags it whole
      const inSet = onLine && state.sel && state.sel.kind === "lines" && state.sel.list.indexOf(onLine) >= 0;
      if (!inSet) state.sel = onObj ? onObj : onLine ? { kind: "lines", list: [onLine] } : null;

      const sel = state.sel;
      if (!sel) drag = null;
      else {
        const targets = sel.kind === "lines" ? sel.list : [sel.o];
        drag = { sel, targets, from: [mx, my], moved: false, before: targets.map((x) => snapOf(sel.kind === "lines" ? "line" : "obj", x)) };
      }
      after();
      return true;
    }
    if (!drag) return true;
    if (kind === "move") {
      const dx = snapBy(mx - drag.from[0]),
        dy = snapBy(my - drag.from[1]);
      if (!dx && !dy) return true;
      drag.from = [drag.from[0] + dx, drag.from[1] + dy];
      drag.moved = true;
      if (drag.sel.kind === "lines")
        for (const l of drag.targets) {
          l.x1 = round1(l.x1 + dx);
          l.y1 = round1(l.y1 + dy);
          l.x2 = round1(l.x2 + dx);
          l.y2 = round1(l.y2 + dy);
          l.src = srcOf(l);
        }
      else {
        const s2 = drag.sel;
        const p = s2.second ? [s2.o.x2, s2.o.y2] : [s2.o.x, s2.o.y];
        setPos(s2.id, s2.o, s2.second, round1(p[0] + dx), round1(p[1] + dy));
      }
      if (redraw) redraw();
      return true;
    }
    const d = drag;
    drag = null;
    if (!d.moved) return true;
    const kind2 = d.sel.kind === "lines" ? "line" : "obj";
    commit({ t: "edits", tag: "move", items: d.targets.map((x, k) => ({ kind: kind2, target: x, before: d.before[k], after: snapOf(kind2, x) })) });
    return true;
  }

  if (t.id === "text") {
    if (kind === "down") {
      if (typing) {
        // a click inside the text moves the caret; anywhere else puts the text
        // down and starts a fresh one
        const o = textOpt();
        const box = textBox(typing.rows, o);
        const pad = state.ed.size * 0.3;
        if (mx >= box.x1 - pad && mx <= box.x2 + pad && my >= box.y1 - pad && my <= box.y2 + pad) {
          const h = hitText(typing.rows, o, mx, my);
          typing.r = h.r;
          typing.c = h.c;
          typing.sel = null;
          drag = { from: { r: h.r, c: h.c } };
          showText();
          return true;
        }
        if (typing.rows.some((r) => r.length)) commitText();
      }
      typing = { x: snap(mx), y: snap(my), rows: [""], r: 0, c: 0, sel: null };
      drag = null;
      showText();
      return true;
    }
    if (kind === "move" && drag && drag.from && typing) {
      const h = hitText(typing.rows, textOpt(), mx, my);
      if (h.r !== drag.from.r || h.c !== drag.from.c) {
        typing.sel = { r: drag.from.r, c: drag.from.c };
        typing.r = h.r;
        typing.c = h.c;
        showText();
      }
      return true;
    }
    if (kind === "up") drag = null;
    return true;
  }

  if (kind !== "down") return true;

  if (t.id === "pipette") {
    const l = lineAt(mx, my);
    if (!l) {
      toast("nothing under the pipette");
      return true;
    }
    // the colour goes to the layer it came from, and the layer follows
    if (l.solid) e.c = l.c.slice();
    else e.cz = l.c.slice();
    e.th = l.th;
    e.round = l.cap !== null;
    e.scenery = !l.solid;
    setTool("line");
    toast("picked " + hex(l.c) + " · width " + l.th + (l.solid ? "" : " · scenery"));
    return true;
  }

  if (t.id === "start" || t.id === "finish") {
    const before = { x: state.lv[t.id].x, y: state.lv[t.id].y };
    commit({ t: "set", key: t.id, before, after: { x: snap(mx), y: snap(my) } });
    return true;
  }
  return true;
}

function curveLines(a, b, off) {
  const mx = (a[0] + b[0]) / 2,
    my = (a[1] + b[1]) / 2;
  const cx = mx + off[0] * 2,
    cy = my + off[1] * 2;
  const out = [];
  let px = a[0],
    py = a[1];
  for (let i = 1; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS,
      m = 1 - u;
    out.push(mkLine(px, py, (px = m * m * a[0] + 2 * m * u * cx + u * u * b[0]), (py = m * m * a[1] + 2 * m * u * cy + u * u * b[1])));
  }
  return out;
}

/* ---------------------------------------------------------------------
   typing

   A small text buffer with the things a caret is expected to do: move, select,
   replace, copy and paste. `typing` holds the rows, where the caret is (row and
   column) and where the selection started, if any.
   --------------------------------------------------------------------- */
let clip = ""; // what Ctrl+C put aside, in case the real
// clipboard is not available to the page

const textOpt = () => {
  const e = state.ed;
  // size, spacing, colour and layer — the thickness of the strokes is worked
  // out from the size inside js/text.js, there is nothing to set here
  return {
    mode: e.textMode,
    size: e.size,
    spacing: e.spacing,
    width: e.textWidth,
    step: e.textStep,
    solid: !e.scenery,
    colour: inkOf(e).slice(),
    family: e.font.family || DEFAULT_FAMILY,
    ox: typing ? typing.x : 0,
    oy: typing ? typing.y : 0,
  };
};

/* caret and selection ordered as they read: [from, to] */
function span() {
  const t = typing;
  if (!t.sel) return null;
  const a = t.sel,
    b = { r: t.r, c: t.c };
  const back = a.r > b.r || (a.r === b.r && a.c > b.c);
  return back ? [b, a] : [a, b];
}

function selectedText() {
  const sp = span();
  if (!sp) return "";
  const [a, b] = sp;
  if (a.r === b.r) return typing.rows[a.r].slice(a.c, b.c);
  const parts = [typing.rows[a.r].slice(a.c)];
  for (let r = a.r + 1; r < b.r; r++) parts.push(typing.rows[r]);
  parts.push(typing.rows[b.r].slice(0, b.c));
  return parts.join("\n");
}

function dropSelection() {
  const sp = span();
  if (!sp) return false;
  const [a, b] = sp;
  const rows = typing.rows;
  rows.splice(a.r, b.r - a.r + 1, rows[a.r].slice(0, a.c) + rows[b.r].slice(b.c));
  typing.r = a.r;
  typing.c = a.c;
  typing.sel = null;
  return true;
}

function insert(str) {
  dropSelection();
  const parts = String(str).replace(/\r/g, "").split("\n");
  const row = typing.rows[typing.r];
  const head = row.slice(0, typing.c),
    tail = row.slice(typing.c);
  if (parts.length === 1) {
    typing.rows[typing.r] = head + parts[0] + tail;
    typing.c += parts[0].length;
  } else {
    const last = parts[parts.length - 1];
    typing.rows.splice(typing.r, 1, head + parts[0], ...parts.slice(1, -1), last + tail);
    typing.r += parts.length - 1;
    typing.c = last.length;
  }
}

/* moving the caret; `keep` extends the selection instead of dropping it */
function moveCaret(dr, dc, keep, toEdge) {
  const t = typing;
  if (keep && !t.sel) t.sel = { r: t.r, c: t.c };
  if (!keep) t.sel = null;
  if (toEdge) {
    t.c = dc < 0 ? 0 : t.rows[t.r].length;
    return;
  }
  if (dc) {
    t.c += dc;
    if (t.c < 0) {
      if (t.r > 0) {
        t.r--;
        t.c = t.rows[t.r].length;
      } else t.c = 0;
    } else if (t.c > t.rows[t.r].length) {
      if (t.r < t.rows.length - 1) {
        t.r++;
        t.c = 0;
      } else t.c = t.rows[t.r].length;
    }
  }
  if (dr) {
    t.r = Math.max(0, Math.min(t.rows.length - 1, t.r + dr));
    t.c = Math.min(t.c, t.rows[t.r].length);
  }
}

/* what the level would gain if Enter were pressed now, plus the caret and
   whatever is selected — those two are overlay, not future lines */
function showText() {
  if (!typing) {
    state.ghost = null;
    state.caret = null;
    if (redraw) redraw();
    return;
  }
  const o = textOpt();
  let lines = [];
  try {
    lines = textToLines(typing.rows, o);
  } catch (err) {
    lines = [];
  }
  state.ghost = lines;

  try {
    const M = metrics(typing.rows, o);
    const y = (r) => o.oy + r * M.lineH;
    const sel = [];
    const sp = span();
    if (sp) {
      const [a, b] = sp;
      for (let r = a.r; r <= b.r; r++) {
        const xs = M.cols[r];
        const c0 = r === a.r ? a.c : 0;
        const c1 = r === b.r ? b.c : xs.length - 1;
        if (c1 <= c0 && !(a.r !== b.r && r !== b.r)) continue;
        sel.push({ x1: o.ox + xs[c0], x2: o.ox + xs[Math.max(c0, c1)] + (c1 <= c0 ? M.lineH * 0.15 : 0), y: y(r), asc: M.asc, desc: M.desc });
      }
    }
    state.caret = {
      x: o.ox + M.cols[typing.r][Math.min(typing.c, M.cols[typing.r].length - 1)],
      y: y(typing.r),
      asc: M.asc,
      desc: M.desc,
      sel,
    };
  } catch (err) {
    state.caret = null;
  }

  if (redraw) redraw();
}

function commitText() {
  const o = textOpt();
  let lines = [];
  try {
    lines = textToLines(typing.rows, o);
  } catch (err) {
    lines = [];
  }
  typing = null;
  state.ghost = null;
  state.caret = null;
  if (!lines.length) {
    if (redraw) redraw();
    return;
  }
  for (const l of lines) {
    l.i = 0;
    l.src = srcOf(l);
  }
  commit({ t: "add", lines });
  toast("text · " + lines.length + " lines");
}

/* the clipboard is asynchronous and may be refused; the internal copy keeps
   Ctrl+C and Ctrl+V working inside the page regardless */
function copySelection(cut) {
  const str = selectedText();
  if (!str) return;
  clip = str;
  try {
    navigator.clipboard.writeText(str).catch(() => {});
  } catch (err) {}
  if (cut) {
    dropSelection();
    showText();
  }
}

function pasteClipboard() {
  const put = (str) => {
    if (str) {
      insert(str);
      showText();
    }
  };
  try {
    navigator.clipboard.readText().then(put, () => put(clip));
  } catch (err) {
    put(clip);
  }
}

/* -> true when the key belonged to the caret and the page should not see it */
export function onKey(e) {
  if (!typing) return false;
  const t = typing;

  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "a") {
      t.sel = { r: 0, c: 0 };
      t.r = t.rows.length - 1;
      t.c = t.rows[t.r].length;
    } else if (k === "c") copySelection(false);
    else if (k === "x") copySelection(true);
    else if (k === "v") pasteClipboard();
    else return false; // Ctrl+Z and friends stay the app's
    showText();
    return true;
  }

  if (e.key === "Enter") {
    if (e.shiftKey) {
      dropSelection();
      const row = t.rows[t.r];
      t.rows.splice(t.r, 1, row.slice(0, t.c), row.slice(t.c));
      t.r++;
      t.c = 0;
    } else {
      commitText();
      return true;
    }
  } else if (e.key === "Backspace") {
    if (!dropSelection()) {
      if (t.c > 0) {
        t.rows[t.r] = t.rows[t.r].slice(0, t.c - 1) + t.rows[t.r].slice(t.c);
        t.c--;
      } else if (t.r > 0) {
        const prev = t.rows[t.r - 1];
        t.rows.splice(t.r - 1, 2, prev + t.rows[t.r]);
        t.r--;
        t.c = prev.length;
      }
    }
  } else if (e.key === "Delete") {
    if (!dropSelection()) {
      const row = t.rows[t.r];
      if (t.c < row.length) t.rows[t.r] = row.slice(0, t.c) + row.slice(t.c + 1);
      else if (t.r < t.rows.length - 1) t.rows.splice(t.r, 2, row + t.rows[t.r + 1]);
    }
  } else if (e.key === "ArrowLeft") moveCaret(0, -1, e.shiftKey);
  else if (e.key === "ArrowRight") moveCaret(0, 1, e.shiftKey);
  else if (e.key === "ArrowUp") moveCaret(-1, 0, e.shiftKey);
  else if (e.key === "ArrowDown") moveCaret(1, 0, e.shiftKey);
  else if (e.key === "Home") moveCaret(0, -1, e.shiftKey, true);
  else if (e.key === "End") moveCaret(0, 1, e.shiftKey, true);
  else if (e.key === "Escape") {
    typing = null;
    state.ghost = null;
    state.caret = null;
    if (redraw) redraw();
    return true;
  } else if (e.key.length === 1) {
    insert(e.key);
  } else return false;

  showText();
  return true;
}

export const isTyping = () => !!typing;

/* a read-only look at the caret, for anything outside that needs to know */
export const textState = () => typing && { rows: typing.rows.slice(), r: typing.r, c: typing.c, sel: typing.sel };

/* Esc drops whatever is half-done */
export function cancelGesture() {
  if (typing) {
    typing = null;
    state.ghost = null;
    state.caret = null;
    if (redraw) redraw();
    return true;
  }
  if (!drag && !bend && !placing && !state.eraseAt && !state.sel) return false;
  if (placing) {
    delete placing.o.half;
    const arr = state.lv.objects[placing.id];
    const k = arr.indexOf(placing.o);
    if (k >= 0) arr.splice(k, 1);
    reindex();
  }
  drag = null;
  bend = null;
  placing = null;
  state.ghost = null;
  state.eraseAt = null;
  state.sel = null;
  if (reinfo) reinfo();
  if (redraw) redraw();
  refreshEditor();
  return true;
}

/* ---------------------------------------------------------------------
   new level — written out and read back, so it is shaped like any other
   --------------------------------------------------------------------- */
export function newLevelText() {
  return writeLevel({
    lines: [],
    bg: [1, 1, 1],
    cam: { x: 200, y: 194 },
    zoom: { x: 1, y: 1 },
    start: { x: 50, y: 50 },
    finish: { x: 350, y: 50 },
    veh: "1",
    gameMode: "0",
    bombTime: "3",
  }).text;
}

/* ---------------------------------------------------------------------
   panel
   --------------------------------------------------------------------- */
const selLines = () => (state.tool === "choose" && state.sel && state.sel.kind === "lines" ? state.sel.list : null);
const selObj = () => (state.tool === "choose" && state.sel && state.sel.kind === "obj" ? state.sel : null);
/* Which objects have an angle at all: the ones the format gives a third
   number to — booster, gravity, saw, mine, sign and portal. A star or a
   checkpoint has x and y and nothing else, so there is nothing to turn. */
const rotates = (id) => byId[id].fields >= 3;
const turns = (s) => rotates(s.id);

/* only the settings the tool — or the thing it has hold of — actually uses */
function fields() {
  const t = state.tool,
    ls = selLines(),
    o = selObj();
  const l = ls && ls.length ? ls[0] : null;
  const drawing = t === "line" || t === "brush" || t === "pencil";
  const text = t === "text";
  const show = (id, on) => {
    $(id).hidden = !on;
  };
  show("row_scenery", drawing || text);
  show("row_colour", drawing || text || !!l);
  // text sets neither: the stroke width comes from the font size, and letters
  // are not drawn with rounded ends
  show("row_width", drawing || !!l);
  show("row_round", drawing || !!l);
  show("row_font", text);
  show("row_size", text);
  show("row_spacing", text);
  show("row_textmode", text);
  show("row_textwidth", text);
  show("row_step", text && state.ed.textMode !== "outline");
  show("hint_text", text);
  show("row_seg", t === "pencil");
  show("row_erase", t === "eraser");
  show("objects", t === "object");
  show("row_rot", (t === "object" && rotates(state.ed.obj)) || !!l || (o && turns(o)));
  show("row_wayt", (t === "object" && state.ed.obj === "way") || (o && o.id === "way"));
  show("row_alt", (t === "object" && state.ed.obj === "portal") || (o && o.id === "portal"));
  show("hint_pipette", t === "pipette");
  show("hint_move", t === "move");
  show("hint_choose", t === "choose" && !state.sel);
}

export function setTool(id) {
  // changing tool must not throw away what has been typed: it is put down as
  // lines, the same as clicking away from the caret does
  if (typing && typing.rows.some((r) => r.length)) commitText();
  state.tool = id;
  cancelGesture();
  for (const b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === id);
  $("toolname").textContent = "tool: " + tool().label;
  $("cv").style.cursor = id === "move" ? "" : id === "choose" ? "default" : "crosshair";
  refreshEditor();
}

export function refreshEditor() {
  const e = state.ed;
  if (!e) return;
  const ls = selLines(),
    o = selObj();
  const l = ls && ls.length ? ls[0] : null;

  $("e_color").value = hex(l ? l.c : inkOf(e));
  $("e_th").value = l ? l.th : e.th;
  $("e_round").checked = l ? l.cap !== null : !!e.round;
  $("e_scenery").checked = !!e.scenery;
  $("e_erase").value = e.eraseR;
  $("e_seg").value = e.seg;
  $("e_wayt").value = o ? o.o.t || 0 : e.wayT;
  $("e_rot").value = l ? deg((Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180) / Math.PI) : o ? deg((o.second ? o.o.a2 : o.o.a) || 0) : e.rot;

  $("magnettool").classList.toggle("on", !!e.magnet);
  $("gridtool").classList.toggle("on", !!state.show.grid);
  $("e_alt").checked = o && o.id === "portal" ? altPortal(o.o) : !!e.alt;
  $("e_size").value = e.size;
  $("e_spacing").value = e.spacing;
  $("e_textmode").value = e.textMode;
  // an empty width means "from the size", and the field shows what that is
  $("e_textwidth").value = e.textWidth || Math.max(1, Math.round(e.size / (e.textMode === "outline" ? 28 : 24)));
  $("e_step").value = e.textStep;
  $("fontname").textContent = e.font.name;
  $("toolsel").textContent = ls ? (ls.length > 1 ? ls.length + " lines selected" : "line " + nm(l.x1) + "," + nm(l.y1) + " → " + nm(l.x2) + "," + nm(l.y2)) : o ? byId[o.id].label + (o.second ? " (exit)" : "") : "";

  for (const el of document.querySelectorAll("[data-obj]")) el.classList.toggle("on", el.dataset.obj === e.obj);
  const mode = state.lv ? String(parseInt(state.lv.gameMode, 10) || 0) : "0";
  const md = MODES.find((m) => m.v === mode) || MODES[0];
  $("e_mode").value = mode;
  $("e_modearg").value = state.lv ? parseInt(state.lv.bombTime, 10) || 0 : 3;
  // the bomb timer is what the trick mode is played against; the other two
  // modes have nothing to do with it
  $("row_modearg").hidden = md.v !== "1";
  $("e_bg").value = state.lv ? hex(state.lv.bg) : "#ffffff";
  $("row_mode").hidden = !state.lv;

  const veh = state.lv ? String(parseInt(state.lv.veh, 10) || 1) : "1";
  for (const el of document.querySelectorAll("[data-veh]")) el.classList.toggle("on", el.dataset.veh === veh);
  fields();
}

/* a panel field changes the selection when there is one, and the settings the
   next stroke will use when there is not */
function edit(tag, fn, def) {
  const ls = selLines(),
    o = selObj();
  if (!ls && !o) {
    def();
    refreshEditor();
    return;
  }

  const kind = ls ? "line" : "obj";
  const targets = ls || [o.o];
  const items = targets.map((t) => ({ kind, target: t, before: snapOf(kind, t) }));
  for (const it of items) {
    fn(it.target, o);
    if (kind === "line") it.target.src = srcOf(it.target);
    it.after = snapOf(kind, it.target);
  }
  commit({ t: "edits", tag, items });
}

export function initEditor(drawFn, infoFn) {
  redraw = drawFn;
  reinfo = infoFn;
  state.tool = "move";
  state.ghost = null;
  state.eraseAt = null;
  state.sel = null;
  state.caret = null;
  state.ed = {
    // the two layers keep their own colour: black for lines, the editor's grey
    // for scenery, and each is remembered while the other is being used
    c: [0, 0, 0],
    cz: [168 / 255, 168 / 255, 168 / 255],
    th: 5,
    round: false,
    scenery: false,
    magnet: false,
    eraseR: 8,
    obj: "turbo",
    rot: 0,
    wayT: 0,
    alt: false,
    seg: 10, // the pencil lays a segment every this many units
    font: { family: null, name: "default · system-ui" },
    size: 60,
    spacing: 0,
    textMode: "outline",
    textWidth: 0, // 0 = worked out from the size
    textStep: 0.5, // how far each inner outline sits from the last
  };

  $("tools").innerHTML =
    TOOLS.map((t) => '<button class="tool" data-tool="' + t.id + '" title="tool: ' + t.label + '">' + ICON[t.icon] + "</button>").join("") +
    '<span class="tsep"></span>' +
    '<button class="tool" id="gridtool" title="grid · points snap to it while it is on">' +
    ICON.grid +
    "</button>" +
    '<button class="tool" id="magnettool" title="magnet: start where the last line ended">' +
    ICON.magnet +
    "</button>" +
    '<span class="tsep"></span>' +
    '<button class="tool" id="undotool" title="Undo (Ctrl+Z)">' +
    ICON.undo +
    "</button>" +
    '<button class="tool flip" id="redotool" title="Redo (Ctrl+Y)">' +
    ICON.undo +
    "</button>" +
    '<button class="tool" id="cleartool" title="remove every line and object">' +
    ICON.clear +
    "</button>";

  $("objects").innerHTML = OBJ.map((d) => '<button class="obj" data-obj="' + d.id + '" title="' + esc(d.label) + '">' + (d.circle ? '<span class="dot" style="background:' + d.circle + '"></span>' : '<img src="' + SPR[d.spr] + '" alt="">') + "<span>" + esc(d.label) + "</span></button>").join("");

  $("vehicles").innerHTML = VEHICLES.map((name, i) => '<button class="veh" data-veh="' + (i + 1) + '" title="' + esc(name) + '">' + '<img src="assets/vehicles/v' + (i + 1) + '.png" alt=""><span>' + esc(name) + "</span></button>").join("");

  $("tools").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tool]");
    if (b) setTool(b.dataset.tool);
  });
  $("objects").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-obj]");
    if (!b) return;
    state.ed.obj = b.dataset.obj;
    refreshEditor();
  });
  $("e_mode").innerHTML = MODES.map((m) => '<option value="' + m.v + '">' + esc(m.label) + "</option>").join("");
  const setMode = () => {
    if (!state.lv) return;
    const before = { m: state.lv.gameMode, b: state.lv.bombTime };
    const b = Math.max(0, Math.min(999, Math.round(parseFloat($("e_modearg").value) || 0)));
    commit({ t: "set", key: "mode", before, after: { m: $("e_mode").value, b: String(b) } });
  };
  $("e_mode").addEventListener("change", setMode);
  $("e_bg").addEventListener("input", () => {
    if (!state.lv) return;
    const m = /^#(..)(..)(..)$/.exec($("e_bg").value);
    if (!m) return;
    commit({ t: "set", key: "bg", before: state.lv.bg.slice(), after: [1, 2, 3].map((k) => parseInt(m[k], 16) / 255) });
  });
  $("e_modearg").addEventListener("input", setMode);

  $("vehicles").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-veh]");
    if (!b || !state.lv) return;
    commit({ t: "set", key: "veh", before: state.lv.veh, after: b.dataset.veh });
    toast("vehicle: " + VEHICLES[+b.dataset.veh - 1]);
  });

  const num = (id, lo, hi) => {
    const v = Math.round(parseFloat($(id).value));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
  };

  $("e_color").addEventListener("input", () => {
    const m = /^#(..)(..)(..)$/.exec($("e_color").value);
    if (!m) return;
    const c = [1, 2, 3].map((k) => parseInt(m[k], 16) / 255);
    edit(
      "colour",
      (t) => {
        t.c = c.slice();
      },
      () => {
        state.ed[state.ed.scenery ? "cz" : "c"] = c;
      },
    );
  });
  $("e_th").addEventListener("input", () => {
    const v = num("e_th", 1, 60);
    if (v === null) return;
    edit(
      "width",
      (t) => {
        t.th = v;
        if (t.cap) t.cap = Math.max(1, Math.round(v / 2));
      },
      () => {
        state.ed.th = v;
      },
    );
  });
  $("e_round").addEventListener("input", () => {
    const on = $("e_round").checked;
    edit(
      "round",
      (t) => {
        t.cap = on ? Math.max(1, Math.round(t.th / 2)) : null;
      },
      () => {
        state.ed.round = on;
      },
    );
  });
  $("e_rot").addEventListener("input", () => {
    const v = num("e_rot", -360, 360);
    if (v === null) return;
    edit(
      "rotation",
      (t, o) => {
        if (o) setAngle(o.id, t, o.second, deg(v));
        else {
          // a line turns about its middle
          const cx = (t.x1 + t.x2) / 2,
            cy = (t.y1 + t.y2) / 2;
          const half = Math.hypot(t.x2 - t.x1, t.y2 - t.y1) / 2;
          const a = (deg(v) * Math.PI) / 180;
          t.x1 = round1(cx - half * Math.cos(a));
          t.y1 = round1(cy - half * Math.sin(a));
          t.x2 = round1(cx + half * Math.cos(a));
          t.y2 = round1(cy + half * Math.sin(a));
        }
      },
      () => {
        state.ed.rot = deg(v);
      },
    );
  });
  $("e_wayt").addEventListener("input", () => {
    const v = num("e_wayt", 0, 2);
    if (v === null) return;
    edit(
      "variant",
      (t, o) => {
        if (o && o.id === "way") {
          t.t = v;
          t.raw[3] = v;
        }
      },
      () => {
        state.ed.wayT = v;
      },
    );
  });
  $("e_alt").addEventListener("input", () => {
    const on = $("e_alt").checked;
    edit(
      "portal look",
      (t, o) => {
        if (o && o.id === "portal") setAlt(t, on);
      },
      () => {
        state.ed.alt = on;
      },
    );
  });
  $("e_seg").addEventListener("input", () => {
    const v = parseFloat($("e_seg").value);
    if (Number.isFinite(v)) state.ed.seg = Math.max(0.1, v);
  });
  $("e_erase").addEventListener("input", () => {
    const v = num("e_erase", 1, 200);
    if (v !== null) state.ed.eraseR = v;
  });
  $("e_scenery").addEventListener("input", () => {
    state.ed.scenery = $("e_scenery").checked;
    refreshEditor(); // each layer brings its own colour along
    showText();
  });

  $("e_font").addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    try {
      state.ed.font = await loadFontFile(f);
      toast("font: " + state.ed.font.name);
    } catch (err) {
      toast("could not use that font file: " + err.message, true);
    }
    refreshEditor();
    showText();
  });
  $("fontreset").addEventListener("click", () => {
    state.ed.font = { family: null, name: "default · system-ui" };
    refreshEditor();
    showText();
  });
  $("e_step").addEventListener("input", () => {
    const v = parseFloat($("e_step").value);
    if (Number.isFinite(v)) state.ed.textStep = Math.max(0.1, Math.min(1, v));
    showText();
  });
  $("e_textwidth").addEventListener("input", () => {
    const v = Math.round(parseFloat($("e_textwidth").value));
    state.ed.textWidth = Number.isFinite(v) && v > 0 ? Math.min(200, v) : 0;
    if (!state.ed.textWidth) refreshEditor(); // empty means "from the size"
    showText();
  });
  for (const [id, key, lo, hi] of [
    ["e_size", "size", 1, 600],
    ["e_spacing", "spacing", -200, 200],
  ])
    $(id).addEventListener("input", () => {
      const v = parseFloat($(id).value);
      if (Number.isFinite(v)) state.ed[key] = Math.max(lo, Math.min(hi, v));
      showText();
    });
  $("e_textmode").addEventListener("change", () => {
    state.ed.textMode = $("e_textmode").value;
    refreshEditor();
    showText();
  });

  $("magnettool").addEventListener("click", () => {
    state.ed.magnet = !state.ed.magnet;
    refreshEditor();
  });
  $("gridtool").addEventListener("click", () => document.querySelector('[data-t="grid"]').click());
  $("undotool").addEventListener("click", undo);
  $("redotool").addEventListener("click", redo);
  $("cleartool").addEventListener("click", () => {
    if (!state.lv) return;
    const items = [];
    for (const d of OBJ) for (const o of state.lv.objects[d.id]) items.push({ id: d.id, o });
    if (!state.lv.lines.length && !items.length) return;
    if (state.lv.lines.length) commit({ t: "del", lines: state.lv.lines.slice() });
    if (items.length) commit({ t: "obj", remove: true, items });
    toast("cleared · undo brings it back");
  });

  setTool("move");
}

/* a fresh file starts with a clean history */
export function resetHistory() {
  undoLog.length = 0;
  redoLog.length = 0;
  drag = null;
  bend = null;
  placing = null;
  lastEnd = null;
  typing = null;
  state.ghost = null;
  state.eraseAt = null;
  state.sel = null;
  state.caret = null;
}
