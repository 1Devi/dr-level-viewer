import {OBJ, FINISH_SIZE, START_SIZE} from "./format.js";
import {hex} from "./util.js";

/* Lines are hidden and listed by look, not by index: same layer + color +
   width + cap radius is one group. */
export const lineKey = l =>
  (l.solid ? "S" : "D") + "|" + hex(l.c) + "|" + l.th + "|" + (l.cap === null ? "-" : l.cap);

export function levelBounds(lv){
  let a = Infinity, b = Infinity, A = -Infinity, B = -Infinity;
  const put = (x, y, p) => { a = Math.min(a, x-p); A = Math.max(A, x+p); b = Math.min(b, y-p); B = Math.max(B, y+p); };
  for(const l of lv.lines){
    const p = Math.max(l.th, (l.cap||0)*2)/2;
    put(l.x1, l.y1, p); put(l.x2, l.y2, p);
  }
  put(lv.finish.x, lv.finish.y, FINISH_SIZE/2);
  put(lv.start.x, lv.start.y, START_SIZE/2);
  for(const d of OBJ) for(const o of lv.objects[d.id]){
    put(o.x, o.y, d.size/2);
    if(o.x2 !== undefined) put(o.x2, o.y2, d.size/2);
  }
  if(!Number.isFinite(a)) return {x1:-200, y1:-200, x2:200, y2:200};
  return {x1:a, y1:b, x2:A, y2:B};
}

export function groupsOf(lv){
  const map = new Map();
  for(const l of lv.lines){
    const key = lineKey(l);
    let g = map.get(key);
    if(!g) map.set(key, g = {key, solid: l.solid, c: l.c, th: l.th, cap: l.cap, n: 0});
    g.n++;
  }
  return [...map.values()].sort((p,q) => (p.solid === q.solid ? q.n - p.n : (p.solid ? 1 : -1)));
}

/* distance from a point to a segment, in level units */
export function segDist(px, py, l){
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const len = dx*dx + dy*dy;
  let t = len ? ((px - l.x1)*dx + (py - l.y1)*dy)/len : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = l.x1 + dx*t - px, qy = l.y1 + dy*t - py;
  return Math.hypot(qx, qy);
}
