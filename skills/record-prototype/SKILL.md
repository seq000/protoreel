---
name: record-prototype
description: Records a click-through walkthrough of an HTML prototype as a video — a deterministic frame-by-frame capture at 60fps, optionally composited inside a device frame from Figma, with a touch ripple or cursor showing each interaction. Use when the user asks to record a prototype, capture a click-through, make a walkthrough video or demo video of a prototype or local page, film a UI flow, turn a prototype into a video for a case study or portfolio, or put a screen recording inside a phone mockup.
---

# Record a prototype walkthrough

Drive a local HTML prototype with Playwright and render it frame by frame, then encode with ffmpeg. Nothing is captured in real time — both the CSS animation clock and `setTimeout` are frozen and advanced 1/60 s per screenshot, so no frame is dropped, no transition is caught mid-race, and a re-run is byte-identical.

**Requires a Mac shell** (Desktop Commander `start_process` or an equivalent local shell), Google Chrome, `playwright-core`, and ffmpeg. The sandboxed Linux shell cannot do this — it has no browser and cannot reach `localhost`. Check with `which ffmpeg` and `ls /Applications/Google\ Chrome.app` before promising anything; if either is missing, say so and stop.

## Workflow

Run the interview first (§1), then build and run the recorder (§2–4), then verify before encoding (§5).

### 1. Interview

Ask with the `AskUserQuestion` tool — **and only that tool.** One question at a time or grouped (it allows up to four per call). Do **not** substitute a custom-built form — an HTML widget, artifact, canvas, or anything else — even if the current environment offers a fancier way to "collect arguments" and it looks like a better fit. `AskUserQuestion` is the one interview mechanism guaranteed to exist wherever this skill is installed; anything else is slower to build, isn't guaranteed to render, and has already failed silently once (see Rules).

**Infer whatever the conversation already answers and skip those questions.** If the user already named the file, don't ask for the source.

1. **Source** — a local `.html` file on disk, or a `localhost` URL. Offer any dev server already running (`curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT`) as a concrete option. A remote public URL works too but warn that the page must load without auth.
2. **Viewport** — `390 × 844` (iPhone), `1440 × 900` (desktop), `1280 × 800` (tablet/laptop), or custom. If the prototype has its own fixed device stage, read its size from the DOM and offer that as the first option.
3. **Device frame** — a Figma node URL (export it, see `references/device-frames.md`), a PNG already on disk, or none. Frames only make sense for phone/tablet captures.
4. **Pointer** — touch ripple (mobile), desktop cursor, or none.
5. **The steps** — either the user dictates them, or points at a screen recording (`.mov`/`.mp4`) of themselves clicking through. For a recording, follow `references/steps-from-recording.md`: sample frames, read what changed, and write the step list — **reproduce only the interactions, never the hunting**, and confirm the derived list before recording.
6. **Output** — WebM + MP4 + poster, MP4 only, or GIF. **Always ask; do not assume.** Also ask where the files should be written.

Summarise the plan in two or three lines and get a yes before running anything.

### 2. Discover selectors

Never guess selectors. Open the page once and list what is actually there, so the step list references real elements:

```js
// in a throwaway Playwright script
page.evaluate(() => [...document.querySelectorAll('button, a, [role=button], input, [data-*]')]
  .map(el => ({ tag: el.tagName, id: el.id, cls: el.className, text: el.textContent.trim().slice(0, 40) })))
```

Prefer stable hooks — `#id`, `[data-x]`, `.class[data-opt="…"]` — over nth-child.

### 3. Write the recorder

Copy `assets/record.template.mjs` into a gitignored working directory next to the prototype (or into the project's existing scratch/wireframe directory if it has one), fill in the config block, and write the step list at the bottom. Keep the script — the user will want to adjust pacing and re-run.

The template already implements everything in `references/frame-stepping.md`. Read that file before modifying the timing code; the two clocks and their failure modes are the whole reason this works.

Available step verbs:

| Verb | What it does |
|---|---|
| `tap(selector, holdFrames)` | Moves the pointer on an eased arc, presses, clicks, blooms the ripple, holds |
| `drag(selector, 'x'\|'y', delta, frames)` | Finger-drags a scrollable element; content tracks the pointer |
| `hold(frames)` | Rests; animations and the ripple keep running |
| `moveTo(x, y, frames)` | Repositions the pointer without clicking |
| `fadeOut(frames)` | Fades the pointer out at the end |

Frames are 1/60 s. A comfortable read is 30–50 frames after a tap, 70–90 after something that changes the whole screen.

### 4. Run it

Run from the Mac shell. A 25–30 s clip takes roughly 2–3 minutes: most of the time is one screenshot per frame.

### 5. Verify before you hand it over

The recorder writes `out/taps.json` — every tap with its frame number and pointer coordinates. Use it:

- **Read a few frames around each tap** and check the pointer is on the element and the ripple is visible. Do not crop blind; use the coordinates from `taps.json`.
- **Confirm the file plays**: `ffprobe` the output for codec, dimensions, frame rate and duration. Report those numbers, not "done".
- If a tap target sat outside the viewport the run **throws by design** — that is the guard in `tap()`, and it means the step list needs a scroll or swipe before that tap, not a bigger viewport.

Then present the files with `present_files`.

## Rules

- **The interview is `AskUserQuestion`, full stop.** Never build a substitute form with a different tool (a widget, artifact, canvas). On 3 Sep 2026, a custom HTML form was built instead — the user never saw it, had to ask where it went, and the session fell back to plain chat questions. Nothing about a richer-looking form is worth that failure mode: `AskUserQuestion` is the only interview surface every install of this skill can rely on.
- **Never claim a recording is finished without inspecting frames.** Correct-looking code is not evidence.
- **Ripple timing runs on the frame clock, not on pointer movement.** If it only advances while the pointer moves, it freezes mid-bloom during holds and reads as if the *next* move triggered it.
- **Reproduce interactions, not mouse wandering.** A recording of someone searching a list is not a script.
- **Keep the recorder script.** Pacing always needs a second pass.
- **Portrait clips break landscape figure layouts.** If the output is going into a web page, say so — a 0.59-ratio video at full figure width paints enormous, and needs a width cap.

## References

| File | Read when |
|---|---|
| `references/frame-stepping.md` | Before touching timing, or when a transition looks wrong |
| `references/device-frames.md` | Compositing into a Figma phone/tablet mockup |
| `references/steps-from-recording.md` | Deriving the step list from a screen recording |
| `references/encoding.md` | Choosing codecs, sizes, posters, GIFs |
| `assets/record.template.mjs` | The recorder itself — copy, don't rewrite |
