# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

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
