# DR Level Viewer

Open a **Draw Rider** level file in the browser and see it exactly as the game
draws it. Drag the file onto the page, or press **Open file** — nothing is
uploaded, it is read locally.

Pan and zoom, hide line groups or object types, hover anything to see its raw
values, export a PNG, share the view via the URL.

Run it locally (ES modules need a server, `file://` won't do):

```bash
python3 -m http.server 8000
```

Sprites in `assets/sprites/` are from Draw Rider by 17Studio.
