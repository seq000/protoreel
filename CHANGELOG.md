# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-09-24

Two halves of the same problem: the recorder didn't really drive the page, it
poked at it. Both were found by recording real prototypes.

### Added

- **Real pointer input.** Actions now go through Chrome's input pipeline over
  CDP, so the page receives trusted events — pointer capture, `:hover`, drag
  libraries and canvas handlers all work. New verbs: `dragTo`, `hover`, `press`,
  `release`, `longPress`. A target can be a selector or `[x, y]` in prototype
  coordinates, which is what SVG and canvas editors need. See
  `docs/pointer-input.md`.
- `clock: { start }` — the wall-clock instant the page believes it is, default
  `09:41:00`. An on-screen clock or ETA is now deliberate and identical between
  runs; `clock: false` opts out.

### Fixed

- **`setInterval`, `requestAnimationFrame`, `performance.now` and `Date` are now
  frozen too.** Only CSS/WAAPI and `setTimeout` were, so anything animating on
  rAF ran at wall-clock speed while each screenshot cost ~130 ms. A navigation
  prototype recorded this way drove several hours of route in a 41-second clip
  and rendered `Time left 0:00 · Distance -82562090` — which reads as a data bug
  in the prototype and was a clock bug here.
- The frame clock is computed as `ticks * 1000 / fps` instead of accumulating
  `now += dt`. The accumulated version drifted to 2999.9999999999995 over 180
  frames — enough to lose an interval fire and shift a displayed clock by a
  second.
- `tap()` fails when something covers the target, naming what is on top.
  `element.click()` always reached its target even when occluded; a real pointer
  does not, and silently clicking an overlay is worse than an error.

### Changed

- `drag(selector, axis, delta)` — which scrolled a scrollable element rather
  than dragging anything — is now **`swipe`**. `drag` still works as an alias,
  so existing configs keep running.
- `pointer: 'touch'` emits touch events and suppresses hover; `pointer: 'cursor'`
  emits mouse events and moves continuously, so desktop hover states appear.

## [0.1.2] — 2026-09-07

### Fixed

- The packaged `.plugin` was rejected on install: *"Plugin contains a top-level
  `bin/` directory."* A claude.ai-hosted plugin may not ship executables, since
  they land on PATH via the CLI without appearing on the admin approval surface.
  The bundle no longer includes `bin/`, `src/` or `package.json` — the engine
  comes from npm, which is where it has lived since 0.1.0, so the plugin only
  needs the skill, `docs/` and `examples/`. `build-plugin.mjs` now fails the
  build if any of those paths reappear, rather than producing a zip that only
  fails at install time.
- The npm package is unaffected; it still ships the CLI, and this changes only
  what goes inside the Claude/Cowork plugin bundle.

## [0.1.1] — 2026-09-07

### Fixed

- The interview could silently skip questions. All six were specified, but the
  instruction to "infer whatever the conversation already answers" was broad
  enough that a run never asked about the device frame or the pointer — two
  settings with no safe default, where a wrong guess costs a full re-record.
  Skipping is now allowed only when the user stated that answer in words;
  inference is explicitly not an answer.
- The plan summary is now required to list all six settings with their values,
  marking any the user didn't choose as `(assumed)`. It's the backstop that
  should have caught the above and didn't, because it was free to mention only
  what had been discussed.
- Dropped the preflight's `npm install github:seq000/protoreel` fallback and
  the README's GitHub install line — the package is on npm as of 0.1.0.

## [0.1.0] — 2026-09-03

First public release.

### Added

- `protoreel` CLI: `protoreel <config.mjs> [name]` records a walkthrough;
  `protoreel inspect <config.mjs>` lists the page's interactive elements with real
  selectors.
- The engine, `src/recorder.js`: frame-stepped capture with both the CSS animation
  clock (via CDP `Animation.setPlaybackRate`) and `setTimeout` (virtual queue,
  installed before page load) frozen and advanced 1/60 s per screenshot. Step verbs
  `tap`, `drag`, `hold`, `moveTo`, `fadeOut`, `extent`; touch-ripple or desktop-cursor
  overlay that rides the frame clock; optional device-frame compositing.
- Outputs: VP9 WebM (two-pass), H.264 MP4, poster JPEG, and palette-based GIF —
  chosen per run with `output: [...]`.
- Config as an ES module: settings plus an async `walkthrough()`; relative paths
  resolve against the config file. `chromePath` / `ffmpegPath` overrides and
  `PROTOREEL_CHROME` / `PROTOREEL_FFMPEG` env vars.
- Claude/Cowork plugin (`.claude-plugin/` + `skills/record-prototype/`) wrapping the
  CLI: six-question interview via `AskUserQuestion`, preflight that offers (asks
  first) to install ffmpeg and the package, verification of frames and `ffprobe`
  output before handing files over.
- Docs: `frame-stepping`, `device-frames`, `steps-from-recording`, `encoding`.
- `npm test`: records a fixture twice and asserts frame count, tap log, ffprobe spec,
  that clocks tick, and byte-identical re-runs. CI on Ubuntu.

[0.1.0]: https://github.com/seq000/protoreel/releases/tag/v0.1.0
