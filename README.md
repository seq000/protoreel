# proto-capture

Turns an HTML prototype into a click-through walkthrough video — the kind you put in
a case study or send to a stakeholder — without screen-recording anything.

Claude drives the prototype in a real browser and renders it one frame at a time, so
the result is a clean 60fps clip with no dropped frames, no stutter, and no cursor
wandering. A touch ripple or cursor shows each interaction, and the whole thing can
sit inside a phone or tablet mockup exported from Figma.

## Using it

Say what you want and Claude asks the rest:

> record a walkthrough of my prototype
> make a video of this click-through inside the iPhone frame
> turn this prototype into a clip for the case study

It will ask for:

1. **The prototype** — an HTML file on disk or a local URL (it offers any dev server it finds running)
2. **The viewport** — 390 × 844, 1440 × 900, 1280 × 800, or your own
3. **A device frame** — a Figma node, a PNG you already have, or none
4. **The pointer** — touch ripple, desktop cursor, or nothing
5. **The steps** — describe them, or hand over a screen recording of yourself clicking through and Claude derives them (it keeps what you interacted with and drops the hunting)
6. **The output** — WebM + MP4 + poster, MP4 only, or GIF, and where to put them

Then it records, checks frames around each interaction, and gives you the files.

A 25–30 second clip takes two to three minutes to render. The recorder script stays
in your project, so adjusting pacing and re-running is one command.

## What you need

Runs on macOS with:

- Google Chrome
- `ffmpeg` (`brew install ffmpeg`)
- `playwright-core` available to Node — either installed in the project or globally

It also needs a real local shell (the Desktop Commander plugin, or any equivalent).
The sandboxed Linux shell can't reach a browser or `localhost`.

For Figma device frames, the Figma MCP connector must be connected — or you can point
at a PNG you exported yourself.

## Why not just screen-record?

A screen recorder samples whatever the browser happened to paint. Dropped frames,
compositor stutter and a transition caught mid-flight all end up in the file, and the
only fix is re-recording until a take is clean. Here the page's own clocks — CSS
animations and `setTimeout` — are frozen and advanced by exactly 1/60 s per
screenshot. Every transition lands on the frame it should, and running it twice gives
byte-identical output.
