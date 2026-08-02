import { state } from "./state.js";
import { $ } from "./util.js";
import { writeLevel } from "./write.js";
import { cv } from "./view.js";
import { toast } from "./toast.js";

const nice = (n) => n.toLocaleString("en-US").replace(/,/g, " ");

/* Level files carry no extension — that is how the game keeps them, and how it
   expects to find them in userlevels. The blob has to be octet-stream for that
   to survive: with text/plain the browser decides the name looks wrong and
   silently appends .txt. */
function levelName() {
  const n = ($("fname").value || "").trim().replace(/[\\/:*?"<>|]/g, "_");
  return n || "level";
}

export function download(name, href) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function saveLevel() {
  if (!state.lv) {
    toast("no level to save");
    return;
  }
  const out = writeLevel(state.lv);
  const url = URL.createObjectURL(new Blob([out.text], { type: "application/octet-stream" }));
  download(levelName(), url);
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  toast("saved · " + nice(out.nSolid) + " lines, " + nice(out.nDecor) + " scenery" + (out.guarded ? " · " + out.guarded + " moved off x = 1.0" : ""));
}

export function savePng() {
  if (!state.lv) {
    toast("no level to save");
    return;
  }
  try {
    download(levelName() + ".png", cv.toDataURL("image/png"));
    toast("PNG saved");
  } catch (e) {
    // happens when the canvas is tainted — an image the browser considers
    // cross-origin was drawn into it
    toast("the browser refused to export the canvas: " + e.message, true);
  }
}
