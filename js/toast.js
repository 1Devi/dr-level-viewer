import { $ } from "./util.js";

/* A line that appears over the stage for a moment. Used for things the user
   asked for and got — a saved file, a blocked export — where a permanent
   panel would be noise. */

let hide = 0;

export function toast(msg, bad) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(hide);
  hide = setTimeout(
    () => {
      el.className = "toast";
    },
    bad ? 6000 : 3200,
  );
}
