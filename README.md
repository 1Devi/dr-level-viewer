# DR Level Viewer

Open a **Draw Rider** level file in the browser and see it exactly as the game
draws it. Drag the file onto the page, or **Menu → Open file** — nothing is
uploaded, it is read locally.

Pan and zoom, hide line groups or object types, hover anything to see its raw
values, share the view via the URL.

## Editing

A tool strip sits on the left of the canvas. The default tool is **move and
zoom**, so the viewer behaves exactly as before until another one is picked; the
rest are the game's own — lines, brush, eraser, pipette, objects, text, start,
finish — with a magnet that starts each stroke where the last one ended, undo
(Ctrl+Z), an editable level name, and pickers for the vehicle, the game mode and
the background. **Menu → New level** (N) starts an empty one.

The **text** tool writes with any font you hand it — TTF, OTF, WOFF2, or whatever
the system already has — and turns the letters into lines, hollow or filled.

## Image → level

**Menu → Pixelate image** (Ctrl+P), or drop a JPG/PNG on the page, turns a
picture into a level: one image pixel becomes one record — a scenery line or a
physical one, your choice. Size, layer, alpha cut-off, a colour to drop,
posterizing and the level background are all live in the preview.
**Generate & view** loads the result straight into the viewer, **Download level**
saves the file for `userlevels`.

## Geometrize → level

**Menu → Geometrize image** (Ctrl+Shift+G) recreates a picture out of shapes and
turns those into lines — the approach Geometrize and primitive use: fit one shape
at a time by hill-climbing, keeping whatever lowers the error. All nine Geometrize
shape types work: four are what Draw Rider draws anyway, the rest are built out of
several lines each, so the preview is the level rather than an impression of it.

Shape data is the same JSON the Geometrize web demo reads and writes, both ways:
**Load JSON** takes a file saved there, **Save JSON** hands one back, and a
`.json` dropped on the page opens the geometrizer.

## Saving

**Menu → Save level** (Ctrl+S) writes the level back out. It is rebuilt from the
parsed model, not handed back as the bytes that came in, so what lands on disk is
always well formed.

Levels are saved without an extension, the way the game keeps them.
**Menu → Save PNG** (Ctrl+Shift+S) exports the current view instead.

**About** in the menu (or F1) lists the shortcuts and the credits.

## Running it

Run it locally (ES modules need a server, `file://` won't do):

```bash
python3 -m http.server 8000
```

Sprites in `assets/sprites/`, the vehicle pictures and the level format are from
Draw Rider by 17Studio.
