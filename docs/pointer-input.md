# Pointer input

protoreel drives Chrome's own input pipeline over CDP. The page receives
**trusted** events — the same ones a hand on a mouse produces — so pointer
capture, `:hover`, drag libraries, canvas handlers and `setPointerCapture` all
behave normally.

This was not always true. Before 0.2.0 `tap()` called `element.click()` and
`drag()` assigned `scrollTop`; the "finger" was a drawn overlay moving
independently, and the page never saw a pointer at all. Anything built on
pointerdown → pointermove → pointerup was impossible to record.

## Verbs

| Verb | What it does |
|---|---|
| `tap(target, after)` | Move, press, release. Fails if something covers the target. |
| `hover(target, frames)` | Move onto it without pressing — reveals `:hover` states and tooltips. |
| `press(target, frames)` | Press and hold. Pair with `release()`. |
| `release(after)` | Lift the pointer. |
| `longPress(target, frames, after)` | Press, wait, release — menus that open on a sustained press. |
| `dragTo(target, to, frames, after)` | Press, move, release. `to` is `[x, y]`, `{dx, dy}`, or a selector. |
| `swipe(sel, axis, delta, frames)` | Scrolls a scrollable element. Was called `drag` before 0.2.0; that name still works. |

A **target** is a selector or `[x, y]` in prototype coordinates. Coordinates are
useful for SVG and canvas, where the thing you want to grab often has no
selector of its own.

## Two things that catch people

**Occlusion.** `element.click()` reached its target even when covered. A real
pointer hits whatever is on top, so `tap()` now checks `elementFromPoint` and
throws naming the element in the way. If a tap started failing when you upgraded,
that overlay was always there — the old recorder just couldn't see it.

**Touch has no hover.** With `pointer: 'touch'` protoreel emits touch events and
suppresses movement while nothing is pressed, because a finger hovering across a
screen is not a thing. With `pointer: 'cursor'` (or `'none'`) it emits mouse
events and the pointer moves continuously, so hover states appear as they would
on a desktop. Pick the one that matches the device you're pretending to be.

## Dragging something that isn't a selector

SVG editors are the common case: the control point you want is a `<circle>`
among many. Read the geometry from the page, then drag by coordinate.

```js
const pts = await page.evaluate(() =>
  [...document.querySelectorAll('#preview-svg circle.handle')].map(el => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
  }));

await dragTo(pts[0], { dx: 30, dy: -50 }, 40);
```

> [!tip] Check what is actually grabbable before blaming the verb
> In a real editor the visible points were two `circle.anchor` (not draggable,
> `cursor: auto`) and two `circle.handle` (draggable, `cursor: grab`). A drag
> aimed at the anchors does nothing and looks exactly like a broken `dragTo`.
> `getComputedStyle(el).cursor` usually settles it in one call.

## Why the drag is frame-stepped

Each intermediate move advances the frame clock by 1/60 s and takes a
screenshot, so the drag is captured at the same cadence as everything else and a
re-run is byte-identical. A library that animates the dragged thing with
`requestAnimationFrame` follows the same clock — see
[frame-stepping](frame-stepping.md).
