import { $ } from "./util.js";

/* The About sheet. Static content lives in index.html — there is nothing to
   compute here, only the opening and closing. */

export const aboutOpen = () => !$("abwrap").hidden;

export function openAbout() {
  $("abwrap").hidden = false;
}
export function closeAbout() {
  $("abwrap").hidden = true;
}

export function initAbout() {
  // opening it is a menu action, see js/menu.js
  $("abx").addEventListener("click", closeAbout);
  $("abwrap").addEventListener("pointerdown", (e) => {
    if (e.target === $("abwrap")) closeAbout();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && aboutOpen()) closeAbout();
  });
}
