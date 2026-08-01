import {state} from "./state.js";

/* The view can be bookmarked: #x,y,zoom */

let saveT = 0;
export function saveView(){
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try{
      history.replaceState(null, "",
        "#" + state.cam.x.toFixed(1) + "," + state.cam.y.toFixed(1) + "," + state.z.toPrecision(6));
    }catch(e){}
  }, 250);
}

/* -> {x, y, z} or null when the hash holds no view */
export function readHash(){
  const m = /^#(-?[\d.]+),(-?[\d.]+),([\d.eE+-]+)$/.exec(location.hash);
  if(!m) return null;
  const z = parseFloat(m[3]);
  if(!Number.isFinite(z)) return null;
  return {x: parseFloat(m[1]), y: parseFloat(m[2]), z};
}
