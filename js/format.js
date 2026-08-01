/* =====================================================================
   Draw Rider LEVEL FORMAT
   Reverse engineered from the game's own bytecode: Resources/resource.car ->
   game.lu, the level loader (it calls get_file() = read"*n" / read"*l").
   Field names below are the game's own variable names.

   1              one number, the game reads it and THROWS IT AWAY
   2              N1 - number of solid lines (lines)
   3              N2 - number of Z lines (linesZ, background)
   then N1+N2 blocks of 4 rows:
       "xx  rL gL bL  sizeF [roundedF]"   rL/gL/bL are 0..1
       yy                                 no sizeF -> 5, no roundedF -> 0
       xx2
       yy2
   xxF yyF                finish (fin.png sprite, 40x40)
   CamX CamY              camera
   CamScaleX CamScaleY    zoom
   iN_g    + N*(x y)      gr_on   - yellow circle: turns gravity OFF
   iN_gF   + N*(x y)      gr_off  - blue circle: turns it back on
   iN_turbo+ N*(x y rot)  turbo   - booster
   iN_bomb + N*(x y)      bomb    - bomb
   startX startY          start (defaults to 58.5 / 32)
   [optional number]      the game tries to read it and throws it away
   "z N"   + N*(x y)      zvezd      - star
   [optional number]
   "c N"   + N*(x y)      checkpoint - checkpoint
   iN_grav + N*(x y rot)  grav    - gravity
   iN_saw  + N*(x y rot)  saw     - saw
   iN_min  + N*(x y rot)  min     - mine
   iN_portal+N*(x y rot x2 y2 rot2)  portal - a pair of portals
   iN_way  + N*(x y rot t_t)  way  - sign, t_t = 0/1/2 (way_0/1/2.png)
   "v N"                  sel_veh    - vehicle
   "m A B"                game_mode A, bomb_time B
   "f r g b"              background color
   "dX"                   game_version - editor version

   The Y axis points DOWN. 1 unit = 1 logical pixel at 100% zoom.
   Draw order: background, grid, linesZ, lines, objects, finish, start.
   ===================================================================== */

export const FINISH_SIZE = 40;   // fin.png, confirmed in code: newImageRect("fin.png",40,40)
export const FINISH_COLOR = "#00a8ff";

/* the start has no sprite of its own — drawn as a square like the finish */
export const START_SIZE = 40;
export const START_COLOR = "#ffa500";

/* Object types in the order they appear in the file.
   fields = numbers per record, size = sprite size in units (from the game code). */
export const OBJ = [
  // Yellow turns gravity off (makes it zero), blue brings it back. The names in
  // the game code say the opposite, so these labels follow behaviour, not code.
  {id:"gr_on",      grp:"A", fields:2, label:"gravity off",  hint:"gr_on",  circle:"#ffff00", size:34},
  {id:"gr_off",     grp:"A", fields:2, label:"gravity on",   hint:"gr_off", circle:"#0000ff", size:34},
  {id:"turbo",      grp:"A", fields:3, label:"booster",      hint:"turbo",  spr:"turbo",      size:50},
  {id:"bomb",       grp:"A", fields:2, label:"bomb",         hint:"bomb",   spr:"bomb",       size:35},
  {id:"zvezd",      key:"z", fields:2, label:"star",         hint:"zvezd",  spr:"star",       size:50},
  {id:"checkpoint", key:"c", fields:2, label:"checkpoint",   hint:"checkpoint", spr:"checkpoint", size:30},
  {id:"grav",       grp:"B", fields:3, label:"gravity",      hint:"grav",   spr:"grav",       size:50},
  {id:"saw",        grp:"B", fields:3, label:"saw",          hint:"saw",    spr:"saw",        size:50},
  {id:"min",        grp:"B", fields:3, label:"mine",         hint:"min",    spr:"min",        size:20},
  {id:"portal",     grp:"B", fields:6, label:"portal",       hint:"portal", spr:"portal",     size:70},
  {id:"way",        grp:"B", fields:4, label:"sign",         hint:"way",    spr:"way_0",      size:50}
];

export const byId = {};
for(const o of OBJ) byId[o.id] = o;
