# Contributing to proto-capture

Thanks for looking at this. It's a small tool — most of the value is in
`assets/record.template.mjs` and the four reference docs it implements, so most
contributions will touch one of those five files.

## Before you open a PR

- **Read the reference doc for whatever you're touching first.**
  `references/frame-stepping.md` explains *why* the two clocks are frozen the way
  they are — it's not incidental. Both failure modes it describes (a jump instead of
  a smooth curve, a timer firing in the wrong frame) are easy to reintroduce by
  accident if you don't know they're the thing being guarded against.
- **Any change to the frame-stepping or timing code needs the verification recipe
  from `frame-stepping.md` run and reported in the PR** — the "tick 30 times and log
  `getBoundingClientRect().top`" check, or the equivalent for whatever you changed. A
  diff that looks right is not evidence; this recorder's entire premise is
  determinism, and determinism bugs don't show up by reading code.
- **Never claim a recording works without inspecting frames.** Same rule the skill
  itself follows (see `SKILL.md`'s Rules section) — run it, check a few frames around
  each interaction using the coordinates in `out/taps.json`, `ffprobe` the output.

## Code style

- `record.template.mjs` is meant to be copied per project and edited in place (see
  the file's own header comment) — keep it a single, dependency-light file rather
  than splitting it into modules, unless the scope note below changes.
- Match the existing style: short functions named after what they do (`tap`, `drag`,
  `hold`, `moveTo`), comments that explain *why* a line exists when it isn't obvious
  (the comment above `step()` about the ripple riding the frame clock is the model to
  follow), no dependencies beyond `playwright-core`.

## Scope note

This repo currently ships as a Claude/Cowork plugin only — `.claude-plugin/` +
`skills/record-prototype/`. There's no standalone CLI yet. If that changes (a
`bin/`/`src/`/`package.json` split), this file gets updated for the new layout; until
then, a PR that assumes a CLI entry point doesn't have anywhere to land.

## Reporting a bug

Include: the prototype's viewport size, whether a device frame was involved, and — if
a recording came out wrong — a frame number from `out/taps.json` where it broke. "The
video looks off" without a frame number is hard to act on.
