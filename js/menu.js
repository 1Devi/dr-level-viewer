import { $ } from "./util.js";
import { state } from "./state.js";

/* The menu bar. Behaves the way a desktop one does: click a title to open it,
   then moving across the bar switches menus without another click; Escape or a
   click anywhere else closes; arrows walk the items.

   Actions are not wired here — initMenu is handed a map of data-a -> function,
   so this file never has to know what "save" means. */

let bar = null,
  menus = [],
  live = null;

const title = (m) => m.querySelector(".mtitle");
const items = (m) => [...m.querySelectorAll(".mitem:not([disabled])")];

function close(focus) {
  for (const m of menus) {
    m.classList.remove("open");
    title(m).setAttribute("aria-expanded", "false");
  }
  if (focus && live) title(live).focus();
  live = null;
}

function open(m) {
  if (live === m) return;
  close();
  m.classList.add("open");
  title(m).setAttribute("aria-expanded", "true");
  live = m;
}

/* items that need a level loaded are dead until there is one */
export function refreshMenu() {
  if (!bar) return;
  for (const b of bar.querySelectorAll('[data-need="level"]')) b.disabled = !state.lv;
}

export function menuOpen() {
  return !!live;
}

export function initMenu(actions) {
  bar = $("menubar");
  menus = [...bar.querySelectorAll(".menu")];

  for (const m of menus) {
    title(m).addEventListener("click", (e) => {
      e.stopPropagation();
      live === m ? close() : open(m);
    });
    // once one is open the bar behaves like a single strip
    title(m).addEventListener("pointerenter", () => {
      if (live) open(m);
    });
  }

  bar.addEventListener("click", (e) => {
    const b = e.target.closest(".mitem");
    if (!b || b.disabled) return;
    close();
    const fn = actions[b.dataset.a];
    if (fn) fn();
  });

  // anything outside a menu closes it, including the other buttons that sit in
  // the bar without a dropdown of their own
  addEventListener("pointerdown", (e) => {
    if (live && !(e.target.closest && e.target.closest(".menu"))) close();
  });
  addEventListener("blur", () => close());

  bar.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close(true);
      e.preventDefault();
      return;
    }
    if (!live) {
      // opening from the keyboard lands on the first item
      if (e.key === "ArrowDown" && e.target.classList.contains("mtitle")) {
        const m = e.target.parentElement;
        open(m);
        (items(m)[0] || e.target).focus();
        e.preventDefault();
      }
      return;
    }
    const list = items(live);
    const at = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
      if (list[next]) list[next].focus();
      e.preventDefault();
    } else if (e.key === "Home" || e.key === "End") {
      (e.key === "Home" ? list[0] : list[list.length - 1]).focus();
      e.preventDefault();
    }
  });

  refreshMenu();
}
