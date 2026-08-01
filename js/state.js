/* Everything mutable lives here so the modules can share it without cycles.
   Mutate the fields, never reassign the object itself. */
export const state = {
  lv: null,                 // parsed level, null until a file is opened
  z: 1,                     // zoom: screen px per level unit
  cam: {x: 0, y: 0},        // level coords at the centre of the canvas
  hidden: new Set(),        // line-group keys and "o|<objId>" that are hidden
  hover: null,              // a line object, or {def, o, i, second?} for objects
  show: {solid:1, decor:1, grid:1, finish:1, start:1, obj:1, bg:1, wire:0},
  W: 0, H: 0, dpr: 1        // canvas size in CSS px and the device ratio
};
