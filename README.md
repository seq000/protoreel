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
npm install protoreel                  # in the folder next to your prototype
cp node_modules/protoreel/examples/walkthrough.config.example.mjs walkthrough.config.mjs
npx protoreel inspect walkthrough.config.mjs   # lists the page's buttons/links/inputs with real selectors
npx protoreel walkthrough.config.mjs           # records → out/walkthrough.{webm,mp4} + poster
```

The config is a small ES module: the settings, plus the walkthrough — a list of
steps, or an async `walkthrough()` that receives the step verbs.

```js
export default {
  source: './index.html',              // file path or http(s) URL
  view: { w: 390, h: 844 },            // the prototype's own viewport
  frame: { png: null },                // or a Figma device frame — see docs/device-frames.md
  pointer: 'touch',                    // 'touch' | 'cursor' | 'none'
  cursor: 'macos',                     // 'macos' | 'macos-dark' (when pointer: 'cursor')
  clock: { start: '2026-01-01T09:41' }, // what time the page thinks it is
  output: ['webm', 'mp4', 'poster'],   // any of webm, mp4, poster, gif

  steps: [
    { do: 'hold', frames: 45 },
    { do: 'tap', target: '#openFilters', after: '800ms' },  // move, press, release, ripple, hold
    { do: 'swipe', target: '#list', axis: 'y', delta: 220 }, // scroll a scrollable element
    { do: 'dragTo', target: '#handle', to: { dx: 90 } },     // actually drag a thing
    { do: 'fadeOut' },
    { do: 'hold', frames: 60 },
  ],
};
```

Durations are frames (1/60 s) or a time like `'800ms'`: 30–50 frames after a tap
reads comfortably, 70–90 after something that changes the whole screen. The list is
validated before Chrome launches, and `steps` can be a path to a `.json` file —
[docs/steps.md](docs/steps.md) has the schema. The same walkthrough as code, for
when you need logic or want to read the page back:

```js
  async walkthrough({ tap, dragTo, swipe, hold, fadeOut, paint }) {
    await paint();
    await hold(45);
    await tap('#openFilters', 50);
    await swipe('#list', 'y', 220, 34);
    await dragTo('#handle', { dx: 90 }, 40);
    await fadeOut(18);
    await hold(60);
  },
```

Every tap is logged to `out/taps.json` with its frame number and coordinates, and a
step list also writes `out/steps.json` with each step's frame range — so you can
open the exact frame and check it.

**Input is real.** Pointer actions go through Chrome's input pipeline, so the page
gets trusted events — sliders, bezier handles, scrubbers, canvas editors and
`:hover` all behave as they do for a human. `docs/pointer-input.md` has the verbs.

**Every clock is frozen**, not just CSS: `setTimeout`, `setInterval`,
`requestAnimationFrame`, `performance.now` and `Date` all advance 1/60 s per
frame. A prototype that animates on rAF, counts down an ETA, or shows a clock
records correctly instead of racing the screenshot loop.

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

- [steps.md](docs/steps.md) — the walkthrough as data: step schema, durations, validation, `steps.json`
- [frame-stepping.md](docs/frame-stepping.md) — the two clocks, why both must be frozen, how to verify it
- [device-frames.md](docs/device-frames.md) — exporting a frame from Figma and measuring the screen slot
- [steps-from-recording.md](docs/steps-from-recording.md) — turning a screen recording into a step list
- [encoding.md](docs/encoding.md) — codecs, CRF, posters, GIFs, and the ffprobe check

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` records a fixture page twice and
asserts the frame count, the tap log, the ffprobe spec of the output, that the clocks
actually tick, that the two runs are byte-identical, and that the same walkthrough
written as a step list renders byte-identical to the function.

MIT — see [LICENSE](LICENSE).
