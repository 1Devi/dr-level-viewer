import {OBJ, byId} from "./format.js";

/* Parses a level file into the object the rest of the viewer works with.
   Throws only when the head of the file cannot be a level at all; everything
   else is collected into `warn` so a half-broken file still renders. */
export function parseLevel(text){
  const L = text.replace(/\r\n?/g, "\n").split("\n");
  while(L.length && L[L.length-1].trim() === "") L.pop();
  if(L.length < 4) throw new Error("file is too short to be a level");

  const warn = [];
  const f = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; };

  const head = L[0].trim();
  const nSolid = parseInt(L[1], 10);
  const nDecor = parseInt(L[2], 10);
  if(!Number.isFinite(nSolid) || !Number.isFinite(nDecor))
    throw new Error("rows 2-3 must be line counts, got: " +
                    JSON.stringify(L[1]) + " / " + JSON.stringify(L[2]));

  const total = nSolid + nDecor;
  const lines = [];
  let i = 3;
  let maxCh = 0;

  for(let k = 0; k < total; k++){
    if(i + 3 > L.length - 1){
      warn.push("header claims " + total + " lines, data only covers " + k);
      break;
    }
    const p = L[i].trim().split(/\s+/);
    if(p.length < 5) warn.push("row " + (i+1) + ": expected 5-6 fields, got " + p.length);
    const c = [f(p[1]), f(p[2]), f(p[3])];
    maxCh = Math.max(maxCh, c[0], c[1], c[2]);
    lines.push({
      i: k,
      solid: k < nSolid,
      x1: f(p[0]), y1: f(L[i+1]), x2: f(L[i+2]), y2: f(L[i+3]),
      c, th: f(p[4]),
      cap: p.length > 5 ? f(p[5]) : null,
      src: L.slice(i, i+4).map(s => s.trim())
    });
    i += 4;
  }
  // if the colors look like 0..255, normalise them
  const div = maxCh > 1.0001 ? 255 : 1;
  if(div === 255){
    warn.push("colors look like 0..255, divided them by 255");
    for(const l of lines) l.c = l.c.map(v => v/255);
  }

  /* ---- tail: numbers are read in sequence, a row starting with a letter opens
     a section ---- */
  const tailStart = i;
  const isKey = () => i < L.length && /^[A-Za-z]/.test(L[i].trim());
  const num = () => {
    if(i >= L.length) return 0;
    const v = parseFloat(L[i]); i++;
    return Number.isFinite(v) ? v : 0;
  };
  const objects = {};
  for(const d of OBJ) objects[d.id] = [];

  const readRecords = (d, n) => {
    const out = [];
    for(let k = 0; k < n; k++){
      if(isKey()){ warn.push(d.id + ": data ran out after " + k + " of " + n); break; }
      const r = [];
      for(let j = 0; j < d.fields; j++) r.push(num());
      const o = {x: r[0], y: r[1], raw: r};
      if(d.fields >= 3) o.a = r[2];
      if(d.id === "portal"){ o.x2 = r[3]; o.y2 = r[4]; o.a2 = r[5]; }
      if(d.id === "way") o.t = r[3];
      out.push(o);
    }
    return out;
  };
  const readList = d => {
    if(isKey()) return [];
    const n = Math.max(0, Math.round(num()));
    return readRecords(d, n);
  };
  // the game tries to read a number and discards it; if a letter is next, it rewinds
  const skipped = [];
  const probe = () => { if(!isKey() && i < L.length && L[i].trim() !== "") skipped.push(num()); };

  const finish = {x: num(), y: num()};
  const cam    = {x: num(), y: num()};
  const zoom   = {x: num(), y: num()};
  for(const d of OBJ) if(d.grp === "A") objects[d.id] = readList(d);
  const start = {x: num(), y: num()};
  probe();

  const sections = [];
  const readKeyed = d => {
    if(!isKey()) return [];
    const t = L[i].trim();
    const m = /^([A-Za-z])[ \t]*(.*)$/.exec(t);
    i++;
    sections.push({key: m[1].toLowerCase(), args: m[2].trim(), raw: t});
    if(m[1].toLowerCase() !== d.key)
      warn.push('expected section "' + d.key + '", file has "' + m[1] + '"');
    const n = Math.max(0, parseInt(m[2], 10) || 0);
    return readRecords(d, n);
  };
  objects.zvezd = readKeyed(byId.zvezd);
  probe();
  objects.checkpoint = readKeyed(byId.checkpoint);
  for(const d of OBJ) if(d.grp === "B") objects[d.id] = readList(d);

  // the rest: letter sections v / m / f / d
  let cur = null;
  for(; i < L.length; i++){
    const t = L[i].trim();
    const m = /^([A-Za-z])[ \t]*(.*)$/.exec(t);
    if(m){
      cur = {key: m[1].toLowerCase(), args: m[2].trim(), raw: t, nums: []};
      sections.push(cur);
    } else if(t !== "" && cur){
      cur.nums.push(f(t)); cur.raw += "\n" + t;
    } else if(t !== ""){
      warn.push("unread number in the tail: " + t);
    }
  }
  const sec = k => sections.find(s => s.key === k);

  const fa = sec("f") ? sec("f").args.split(/\s+/).map(f) : null;
  const bg = fa && fa.length >= 3 ? [fa[0]/div, fa[1]/div, fa[2]/div] : [1,1,1];
  const mode = sec("m") ? sec("m").args.split(/\s+/) : [];

  let nObj = 0;
  for(const d of OBJ) nObj += objects[d.id].length;

  return {
    head, nSolid, nDecor, lines, objects, sections, bg, nObj, skipped,
    finish, cam, zoom, start,
    editor: sec("d") ? sec("d").args : "",
    veh:    sec("v") ? sec("v").args : "",
    gameMode: mode[0] || "", bombTime: mode[1] || "",
    warn,
    tailRaw: L.slice(tailStart).join("\n")
  };
}
