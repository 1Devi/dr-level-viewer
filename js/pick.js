import {state} from "./state.js";
import {OBJ} from "./format.js";
import {lineKey, segDist} from "./level.js";
import {toLvl} from "./view.js";

/* What is under the cursor? Returns a line, {def, o, i, second?} or null. */
export function pickAt(sx, sy){
  const {lv, show, hidden, z} = state;
  if(!lv) return null;
  const [mx, my] = toLvl(sx, sy);
  const tol = 3/z;
  // objects are drawn on top of lines, so test them first
  if(show.obj) for(let d = OBJ.length - 1; d >= 0; d--){
    const def = OBJ[d];
    if(hidden.has("o|" + def.id)) continue;
    const r = def.size/2 + tol;
    const list = lv.objects[def.id];
    for(let k = list.length - 1; k >= 0; k--){
      const o = list[k];
      if(Math.hypot(o.x - mx, o.y - my) <= r) return {def, o, i: k};
      if(o.x2 !== undefined && Math.hypot(o.x2 - mx, o.y2 - my) <= r)
        return {def, o, i: k, second: true};
    }
  }
  for(let k = lv.lines.length - 1; k >= 0; k--){
    const l = lv.lines[k];
    if(!(l.solid ? show.solid : show.decor)) continue;
    if(hidden.has(lineKey(l))) continue;
    if(segDist(mx, my, l) <= l.th/2 + tol) return l;
  }
  return null;
}
