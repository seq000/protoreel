# Frame stepping — why the recording is deterministic

Real-time screen capture of a browser drops frames, and a screenshot taken while a
transition is running lands wherever the scheduler happened to be. Both problems
disappear if the page's own sense of time is under your control. This is what
`src/recorder.js` implements; the snippets below are the load-bearing parts of it.

**Every clock the page can read must be frozen.** Missing one produces a video
that looks *almost* right, which is worse than one that obviously fails. There
are six, and 0.1.x froze two of them:

| Clock | Who uses it |
|---|---|
| CSS / WAAPI | transitions, keyframes |
| `setTimeout` | delays, staged reveals |
| `setInterval` | on-screen clocks, polling |
| `requestAnimationFrame` | JS animation, canvas, map easings, physics |
| `performance.now` | anything measuring elapsed time |
| `Date` | displayed clocks, ETAs, "arrives at 09:41" |

The last four were added in 0.2.0, after a recording of a car-navigation
prototype came out reading `Time left 0:00 · Distance -82562090`. The drive
simulation ran on `requestAnimationFrame` and `performance.now`, which were
still on the wall clock: a screenshot costs ~130 ms of real time, so across a
41-second clip the car drove several hours of route. It read as a data bug in
the prototype. It was a clock bug in the recorder.

## Clock 1 — CSS transitions and animations

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });   // freeze
```

`playbackRate: 0` stops every animation, including ones that start later. Advance
them by hand, once per frame:

```js
await page.evaluate((dt) => {
  document.getAnimations().forEach(a => { a.currentTime = (a.currentTime || 0) + dt; });
}, 1000 / 60);
```

`document.getAnimations()` returns animations that exist *now*, so it naturally picks
up transitions created by the click you just made. It also covers CSS keyframe
animations — staggered list rows, chip enter/exit, checkbox pops.

**Verify it works before recording the whole thing.** Click something with a slide
transition, tick 30 times, and log the element's `getBoundingClientRect().top` each
frame. You should see a smooth eased curve over ~20–25 frames. A column of identical
numbers means the freeze took but the ticking didn't; a jump from start to end in one
frame means the freeze didn't take.

## Clocks 2–6 — the page's own timers

Prototypes use timers for the things a CSS transition can't express: removing a chip
after its exit animation, swapping a count after a fade, re-rendering a grid. Those
still run on wall-clock time while your frame loop is busy taking screenshots, so
they fire in the wrong frame — or several at once during a long screenshot.

Replace the timer with a queue **before the page loads**, so the page's own script
picks up the replacement:

All five are replaced in one `addInitScript` — see `src/recorder.js` for the
full version. The shape:

```js
window.setTimeout  = (fn, ms, ...a) => { timers.push({ at: now + ms, fn, a }); … };
window.setInterval = (fn, ms, ...a) => { timers.push({ at: now + ms, every: ms, fn, a }); … };
window.requestAnimationFrame = (fn) => { raf.push({ fn }); … };
Object.defineProperty(window.performance, 'now', { value: () => now });
window.Date = VDate;                       // reports clock.start + now

window.__vtick = () => {
  ticks++;
  now = ticks * 1000 / fps;                // computed, never accumulated
  runDueTimers();                          // timers first: one may schedule a frame
  runRafCallbacks(now);
};
```

`addInitScript` runs before any page script, which is what makes this work —
patching after `goto` misses any timer the page armed during load, and misses a
library that captured `requestAnimationFrame` at module scope entirely.

> [!warning] Compute the clock, don't accumulate it
> `now += dt` looks equivalent and is not. 1000/60 has no exact binary
> representation, and 180 additions of it land on 2999.9999999999995 — enough to
> make a 100 ms interval miss its 30th fire and an on-screen clock read 09:41:02
> instead of 09:41:03. `ticks * 1000 / fps` is exact integer arithmetic for any
> integer fps. Both failures showed up in the test suite the day this was written.

**`Date` is fixed, not just frozen.** It starts at `config.clock.start`
(default `09:41:00`) and advances with the frame clock, so a clock or an ETA
rendered on screen is a deliberate choice and identical between runs. Pass
`clock: false` to leave the page's `Date` alone.

## The frame loop

```js
const tick = async () => {
  await page.evaluate((dt) => {
    document.getAnimations().forEach(a => { a.currentTime = (a.currentTime || 0) + dt; });
    window.__vtick(dt);
  }, 1000 / 60);
  await page.screenshot({ path: `.frames/${String(n++).padStart(5, '0')}.png` });
};
```

One screenshot per tick, sequentially numbered — ffmpeg reads them as `%05d.png`.

Cost is about one screenshot per 90 ms, so a 27 s clip (1600 frames) takes 2–3
minutes. That is the price of determinism; do not try to parallelise it.

## Overlays must ride the same clock

Anything you draw yourself — pointer, ripple, captions — advances in the frame loop,
never on a wall clock and never only when something else happens.

The classic bug: advancing the ripple only inside the pointer-move helper. It then
freezes mid-bloom whenever the pointer rests and completes on the *next* move, so the
ripple appears to be triggered by moving rather than by tapping. Fix: a single
`step()` that advances the ripple, repaints, and ticks — and make `hold()` call
`step()`, not `tick()`.

## Interacting

Use `element.click()` inside `page.evaluate`, not `page.mouse.click`. The pointer
graphic is decoration; the click needs to hit the element the step list names, and
real mouse coordinates drift as soon as anything scrolls.

Guard every tap against an off-screen target:

```js
if (!(await visible(sel))) throw new Error('tap target off-screen: ' + sel);
```

`element.click()` happily fires on something outside the viewport, and the pointer
graphic then flies past the screen edge with no visible cause. Failing loudly at
record time is the whole point of the guard — the fix belongs in the step list
(scroll or swipe first), not in the recorder.
