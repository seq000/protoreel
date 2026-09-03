# protoreel

Turns an HTML prototype into a click-through walkthrough video — the kind you put in
a case study or send to a stakeholder — without screen-recording anything.

It drives the prototype in a real browser and renders it one frame at a time, so the
result is a clean 60fps clip with no dropped frames, no stutter, and no cursor
wandering. A touch ripple or cursor shows each interaction, and the whole thing can
sit inside a phone or tablet mockup exported from Figma. Run it twice and you get
byte-identical output.

Two ways to use it: a command-line tool, or a Claude plugin that asks you six
questions and does the rest.

## CLI

```bash
npm install github:seq000/protoreel    # in the folder next to your prototype (not on npm yet)
cp node_modules/protoreel/examples/walkthrough.config.example.mjs walkthrough.config.mjs
npx protoreel inspect walkthrough.config.mjs   # lists the page's buttons/links/inputs with real selectors
npx protoreel walkthrough.config.mjs           # records → out/walkthrough.{webm,mp4} + poster
```

The config is a small ES module: the settings, plus an async `walkthrough()` that
receives the step verbs.

```js
export default {
  source: './index.html',              // file path or http(s) URL
  view: { w: 390, h: 844 },            // the prototype's own viewport
  frame: { png: null },                // or a Figma device frame — see docs/device-frames.md
  pointer: 'touch',                    // 'touch' | 'cursor' | 'none'
  output: ['webm', 'mp4', 'poster'],   // any of webm, mp4, poster, gif

  async walkthrough({ tap, drag, hold, fadeOut, extent, paint }) {
    await paint();
    await hold(45);
    await tap('#openFilters', 50);           // move, press, click, ripple, hold 50 frames
    await drag('#list', 'y', 220, 34);       // finger-drag a scrollable element
    await fadeOut(18);
    await hold(60);
  },
};
```

Frames are 1/60 s: 30–50 after a tap reads comfortably, 70–90 after something that
changes the whole screen. Every tap is logged to `out/taps.json` with its frame
number and coordinates, so you can open the exact frame and check it.

A 25–30 second clip takes two to three minutes to render — one screenshot per frame
is the price of determinism.

## Claude plugin

The same engine, wrapped in a skill. Install the plugin, then say what you want:

> record a walkthrough of my prototype
> make a video of this click-through inside the iPhone frame
> turn this prototype into a clip for the case study

Claude asks for the prototype, the viewport, a device frame (or none), the pointer
style, the steps — described, or derived from a screen recording of you clicking
through — and the output format. Then it writes the config, records, checks frames
around each interaction, and hands you the files. The config stays in your project,
so adjusting pacing and re-running is one command.

## What you need

- **Google Chrome** — install it yourself. Any Chromium works via `chromePath` in the config or `PROTOREEL_CHROME`.
- **ffmpeg** — `brew install ffmpeg` on macOS, `apt install ffmpeg` on Debian/Ubuntu. Or set `ffmpegPath` / `PROTOREEL_FFMPEG`.
- **Node 18+.**

Developed and used on macOS; CI runs the test suite on Ubuntu. The Claude plugin
additionally needs a real local shell (the Desktop Commander plugin or equivalent) —
Cowork's sandboxed Linux shell can't reach a browser or `localhost`. For Figma device
frames through Claude, the Figma MCP connector must be connected, or point at a PNG
you exported yourself.

## Why not just screen-record?

A screen recorder samples whatever the browser happened to paint. Dropped frames,
compositor stutter and a transition caught mid-flight all end up in the file, and the
only fix is re-recording until a take is clean. Here the page's own clocks — CSS
animations and `setTimeout` — are frozen and advanced by exactly 1/60 s per
screenshot. Every transition lands on the frame it should, and running it twice gives
byte-identical output. [docs/frame-stepping.md](docs/frame-stepping.md) has the
details and the failure modes.

## Docs

- [frame-stepping.md](docs/frame-stepping.md) — the two clocks, why both must be frozen, how to verify it
- [device-frames.md](docs/device-frames.md) — exporting a frame from Figma and measuring the screen slot
- [steps-from-recording.md](docs/steps-from-recording.md) — turning a screen recording into a step list
- [encoding.md](docs/encoding.md) — codecs, CRF, posters, GIFs, and the ffprobe check

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` records a fixture page twice and
asserts the frame count, the tap log, the ffprobe spec of the output, that the clocks
actually tick, and that the two runs are byte-identical.

MIT — see [LICENSE](LICENSE).
