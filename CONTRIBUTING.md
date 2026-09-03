# Contributing to protoreel

Thanks for looking at this. It's a small tool — most of the value is in
`src/recorder.js` and the four docs it implements, so most contributions will touch
one of those five files.

## Running the tests

```bash
npm install
npm test
```

Needs Google Chrome and ffmpeg on the machine (see the README). The test records
`test/fixture/` twice and asserts the frame count, `taps.json`, the ffprobe spec of
the output, that frames change during a transition and settle after it, and that the
two runs are byte-identical. CI runs the same thing on Ubuntu.

## Before you open a PR

- **Read the doc for whatever you're touching first.** `docs/frame-stepping.md`
  explains *why* the two clocks are frozen the way they are — it's not incidental.
  Both failure modes it describes (a jump instead of a smooth curve, a timer firing
  in the wrong frame) are easy to reintroduce by accident if you don't know they're
  the thing being guarded against.
- **Any change to the frame-stepping or timing code needs the verification recipe
  from `docs/frame-stepping.md` run and reported in the PR** — the "tick 30 times and
  log `getBoundingClientRect().top`" check, or the equivalent for what you changed.
  `npm test` passing is necessary, not sufficient: it checks that frames *change*
  during a transition, not that the curve is right. A diff that looks right is not
  evidence; this recorder's entire premise is determinism, and determinism bugs don't
  show up by reading code.
- **Never claim a recording works without inspecting frames.** Run it, look at a few
  frames around each interaction using the coordinates in `out/taps.json`, `ffprobe`
  the output.

## Code style

- `src/recorder.js` is one file on purpose — the step verbs are closures over one
  run's state, and splitting them into modules would mean threading that state
  through. Keep it that way unless there's a concrete reason.
- Match the existing style: short functions named after what they do (`tap`, `drag`,
  `hold`, `moveTo`), comments that explain *why* a line exists when it isn't obvious
  (the comment above `step()` about the ripple riding the frame clock is the model to
  follow), no dependencies beyond `playwright-core`.
- The CLI (`bin/record.mjs`) stays thin: parse arguments, load the config, call the
  engine. Behaviour belongs in `src/`.
- The Claude skill (`skills/record-prototype/SKILL.md`) is a wrapper over the CLI. If
  you add a config option, document it in `examples/walkthrough.config.example.mjs`
  and, if it changes the interview, in the skill.

## Reporting a bug

Include: the prototype's viewport size, whether a device frame was involved, and — if
a recording came out wrong — a frame number from `out/taps.json` where it broke. "The
video looks off" without a frame number is hard to act on.
