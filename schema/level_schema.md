# Draw Rider level format

What is stored, where it sits and in what notation. Everything here was checked
against levels the game itself wrote and against its own save routine in
`resource.car`.

UTF-8, **CRLF** line endings, and **no trailing newline**. The files carry no
extension — that is how the game keeps them, in
`%AppData%\17Studio\Draw Rider\Documents\userlevels`.

---

## Layout

```
0                      format version (read and thrown away)
5451                   number of solid lines
8968                   number of scenery lines
<line records>         4 rows each, solid first, scenery after
<footer>               24 rows, with object records nested inside
```

Total rows: `3 + 4*(lines) + 24 + <object rows>`.

---

## Line record — 4 rows

```
100.0 0.00 0.00 0.00 5 3      x1  R G B  width  [rounding]
190.0                         y1
107.4                         x2
159.1                         y2
```

| field          | notation                          | default | meaning                              |
| -------------- | --------------------------------- | ------- | ------------------------------------ |
| `x1`           | `%.1f`                            | —       | start X                              |
| `R G B`        | `%.2f`                            | `0`     | colour, 0…1                          |
| width          | raw number, **may be fractional** | `5`     | `sizeF`, the height of the rectangle |
| rounding       | raw number, **may be fractional** | absent  | `roundedF`, written only when set    |
| `y1` `x2` `y2` | `%.1f`                            | —       | the remaining ends                   |

The first row may hold **a single number** — just `x1`. Colour is then black,
width 5, no rounding. Older levels lean on that.

### What the game draws

A line is not a segment but a **rotated rectangle**: the distance between the
ends becomes the width, `sizeF` becomes the height, and the rectangle is placed
on the midpoint and turned to match.

```lua
lines[i] = display.newRoundedRect(0, 0, length(p1,p2), sizeF, 0)
lines[i].rotation = angle(p1, p2)
if 0 < roundedF then
   lines[i].path.width  = lines[i].path.width + sizeF
   lines[i].path.radius = sizeF
end
```

Two consequences that are easy to forget:

- a zero-length segment with rounding is a **disc** as wide as the line;
- a rounded line has round ends, so a chain of them closes with no notch at the
  joints.

---

## Footer — 24 rows

```
 0  350.0                 finish X           %.1f
 1  50.0                  finish Y           %.1f
 2  200.0                 camera X           %.1f
 3  194.0                 camera Y           %.1f
 4  1                     scale X            raw, often long
 5  1                     scale Y            raw
 6  0                     gr_on count        + records
 7  0                     gr_off count       + records
 8  0                     turbo count        + records
 9  0                     bomb count         + records
10  50.0                  start X            %.1f
11  50.0                  start Y            %.1f
12  z 0                   stars              + records
13  c 0                   checkpoints        + records
14  0                     grav count         + records
15  0                     saw count          + records
16  0                     min count          + records
17  0                     portal count       + records
18  0                     way count          + records
19  v 1                   vehicle
20  m 0 3                 game mode, bomb time
21                        empty row
22  f 1.000 1.000 1.000   background colour   %.3f
23  d10.0                 game version
```

Rows 6–9 and 14–18 are **counts**: where one says N, N object records of that
type follow, each as many rows as the type has fields.

---

## Objects

| type                           | count at | fields | contents                          |
| ------------------------------ | -------- | ------ | --------------------------------- |
| `gr_on` — gravity off (yellow) | row 6    | 2      | x, y                              |
| `gr_off` — gravity on (blue)   | row 7    | 2      | x, y                              |
| `turbo` — booster              | row 8    | 3      | x, y, rotation                    |
| `bomb`                         | row 9    | 2      | x, y                              |
| `zvezd` — star                 | `z N`    | 2      | x, y                              |
| `checkpoint`                   | `c N`    | 2      | x, y                              |
| `grav` — gravity               | row 14   | 3      | x, y, rotation                    |
| `saw`                          | row 15   | 3      | x, y, rotation                    |
| `min` — mine                   | row 16   | 3      | x, y, rotation                    |
| `portal`                       | row 17   | 6      | x, y, rotation, x2, y2, rotation2 |
| `way` — sign                   | row 18   | 4      | x, y, rotation, variant 0/1/2     |

Every object number is `%.1f`; the sign variant is a whole number. Rotation
exists exactly where a type has three fields or more — a star, a checkpoint, a
bomb and either gravity circle have nothing to turn.

### The portal's second look

A portal may carry a **seventh, optional** number, and it lives **on the same
row as `x2`** — the same trick the rounding uses on the first row of a line
record:

```
1            portal count
60.0         entrance x
-40.0        y
0.0          rotation
300.0 1      exit x and the flag        <- here
-40.0        exit y
0.0          exit rotation
```

It is a switch, not an amount: files written by the game hold either nothing
there or `1`. With the flag set the game draws the portal with its other pair of
sprites, `portal_editor.png` and `portal_e_editor.png`.

The loader reads objects **by rows**, not as a run of numbers, which is why the
extra field does not throw it off.

---

## Game mode and vehicle

`m A B`, where `A` is the mode and `B` the bomb time.

| `A` | mode                        |
| --- | --------------------------- |
| 0   | ordinary, against the clock |
| 1   | tricks, on score            |
| 2   | "oh no", no vehicle         |

`v N` — vehicle, 1…9: Bicycle, Motorcycle, ATV, Sled, Scooter, Segway,
Mini bike, Hoverboard, Monster.

---

## Precision

The game writes with three format strings; everything else goes out as the bare
number.

| format     | fields                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| `%.1f`     | every coordinate: line ends, finish, camera, start, object x/y/rotation |
| `%.2f`     | line colour                                                             |
| `%.3f`     | background colour                                                       |
| raw number | width, rounding, scale, counts, `v`, `m`, extra fields on object rows   |

Raw fields **may be fractional and may be long**: a rounded line of width 15
carries a rounding of `7.5`, and a scale can read `1.0919997692108`. Rounding
them off silently alters the level.

---

## Object format (the `myobjects` folder)

Three differences:

```
0                    version
5                    a SINGLE line count, solid and scenery together
200.0                bounding WIDTH
50.0                 bounding HEIGHT
<records, 4 rows each>
163.9                camera X
196.2                camera Y
1.21                 scale
1.21                 scale
0 0 0 0              empty arrays
z 0
c 0
0 0 0 0 0
v 1
m 0 3
                     empty row
f 1.000 1.000 1.000
d10.0
```

A 20-row footer instead of 24: **no start and no finish**. Geometry is local,
x runs right from zero and the object sits entirely below zero on y.
