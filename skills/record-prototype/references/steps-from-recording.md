# Deriving a step list from a screen recording

The user hands over a `.mov` of themselves clicking through the prototype. Read it,
extract what they *did*, and throw away how they got there.

## Sample, don't watch

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=width,height,r_frame_rate -of default=nw=1 rec.mov
mkdir -p /tmp/rec && ffmpeg -v error -y -i rec.mov -vf "fps=2,scale=-2:600" /tmp/rec/f%04d.png
```

2 fps is enough to see every state change in a UI walkthrough and keeps a 40 s
recording to ~80 frames. Tile them into contact sheets of 20 and read those, rather
than pulling 80 images into the conversation one at a time:

```python
from PIL import Image; import glob
fs = sorted(glob.glob('/tmp/rec/f*.png'))[:20]
ims = [Image.open(f) for f in fs]; w, h = ims[0].size
sheet = Image.new('RGB', (w*10, h*2), 'white')
for i, im in enumerate(ims): sheet.paste(im, ((i%10)*w, (i//10)*h))
sheet.save('sheet1.png')
```

Read the sheets in order and write down each **state change** — a drawer opens, a
checkbox fills, a count changes, chips appear, the page scrolls. The state changes
are the script. The cursor positions between them are not.

## What to keep and what to drop

| In the recording | In the script |
|---|---|
| Scrolling a long list looking for a value | One deliberate scroll, only if the value is genuinely below the fold |
| Cursor drifting while the user reads | Nothing — a `hold()` instead |
| Mis-clicks, undo, re-selection | Nothing |
| Opening a menu, closing it, opening it again | One open |
| Checking three boxes in a row | Three taps, tightly spaced |
| A pause on a screen that just changed | `hold()` long enough to read it |

The result should be shorter than the source recording — usually by a third. That is
the point: the user was searching, the video is explaining.

## Numbers matter

Read the values off the frames — counts, labels, badge numbers. "Apply (303)" tells
you exactly which options were checked, and lets you verify the recording reproduced
the same state. If a number in your render disagrees with the source recording, the
step list is wrong, not the prototype.

## Confirm before recording

Show the derived list as taps/scrolls/holds in order and ask for a yes. Two or three
minutes of rendering is cheap, but so is a correction — and the user is the only one
who knows whether a detour was hunting or a deliberate demonstration.
