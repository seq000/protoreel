# Device frames

The prototype is scaled into the screen slot of a frame image, with the frame drawn
behind it as the page background. Because the frame is behind, its bezel cannot cover
the prototype — anything that must sit *on top* (a notch or dynamic island) is drawn
as a separate element above.

## Getting the frame out of Figma

Export the frame as PNG at **2×**, **with the screen slot empty or covered** —
whatever is in the slot will sit behind the live prototype and show through at the
corners. In Figma's export panel that's the node → Export → PNG → 2x.

If you're driving Figma through its MCP connector (as the Claude skill does), use
`download_assets`, **not** `get_screenshot`:

```
download_assets  fileKey=<key>  nodeId=<node>  defaultFormat=png  defaultScale=2
```

`get_screenshot`'s `maxDimension` is a ceiling, not a scale — asking for 2× on a
488px node returns 488px, silently. `download_assets` has a real `defaultScale`
(max 4). For a mockup built from a component with a `screen` slot, `get_metadata` on
the frame gives you the slot's x/y/width/height directly — the fastest route to the
numbers below.

## Measuring the screen slot

Never eyeball it. Read the exported PNG:

```python
from PIL import Image; import numpy as np
a = np.array(Image.open('export@2x.png').convert('RGB')).astype(int)
blk = a.max(axis=2) < 12                     # the black bezel
row = blk[800]                               # a row through the middle
first = np.argmax(row)                       # bezel outer edge
x0 = first + np.argmax(~row[first:])         # screen starts here
x1 = x0 + np.argmax(blk[x0:]) - 1            # and ends here
```

Do the same on a column for y. Divide by the export scale to get 1× numbers. Corner
radius: walk down from the top edge recording the first non-bezel x per row — the
offset decays to 0 over roughly `r` rows.

Sanity check the result by rendering frame 0 and comparing its corners against the
original export at the same crop. They should be indistinguishable.

## Config

In `walkthrough.config.mjs` (paths resolve against the config file):

```js
frame: {
  png: './frame/export@2x.png',
  stage:  { w: 488, h: 830 },                  // frame size at 1×
  screen: { x: 76, y: 52, w: 336, h: 726, r: 45 },
  island: { x: 193, y: 60.5, w: 98.5, h: 31 }, // or null
}
```

The prototype keeps its own CSS width (e.g. 390) and is transformed by
`screen.w / view.w`, so its internal layout, media queries and font sizes are
unchanged — only the final pixels are scaled. Output resolution is
`stage × deviceScaleFactor`, e.g. 488×830 at 2× → 976×1660.

## Pitfalls

- **A frame exported *with* a screen fill** leaves that fill visible in the corner
  radius, one pixel outside the prototype. Export the slot empty.
- **The prototype's own device chrome must be suppressed** — many prototypes draw
  their own phone shell with a shadow at desktop sizes. Override
  `box-shadow: none` and let the frame provide it.
- **Status bars double up.** If the prototype draws its own status bar *and* the
  frame image has one, decide which to keep. Keeping the prototype's is usually
  right: it scrolls and reacts with the UI.
- **Rounded corners need `overflow: hidden`** on the prototype root, with the radius
  divided by the scale (`screen.r / S`) since the transform scales it back.
- **Portrait output breaks landscape layouts.** A 976×1660 clip dropped into a
  1248px-wide figure paints over 2000px tall. Flag it; the page needs a width cap.
