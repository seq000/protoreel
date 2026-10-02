# Steps as data

A walkthrough can be a list of step objects instead of a function. Both forms
drive the same verbs, so they render byte-identical frames — the test suite
checks exactly that. Use data when the walkthrough is a plain click-through;
use the function when you need logic, or `page` to read something back.

```js
export default {
  source: './index.html',
  view: { w: 390, h: 844 },
  steps: [
    { do: 'hold', frames: 45 },
    { do: 'tap', target: '#openFilters', after: '800ms' },
    { do: 'swipe', target: '#list', axis: 'y', delta: 220 },
    { do: 'dragTo', target: '#handle', to: { dx: 90 }, frames: 40 },
    { do: 'fadeOut' },
    { do: 'hold', frames: 60 },
  ],
};
```

`steps` can also be a path to a JSON file, resolved against the config:

```js
steps: './walkthrough.steps.json',   // an array, or { "steps": [ ... ] }
```

A config has `steps` or `walkthrough()`, never both. With steps, the engine
calls `paint()` for you before the first step.

## Durations

Every duration — `frames`, `after` — is a number of frames (1/60 s at the
default fps) or a time string: `'500ms'`, `'1.5s'`. Time is rounded to the
nearest frame at `config.fps`. `config.slow` multiplies either, exactly as it
does for the function form.

## Steps

Defaults are the verbs' own; `{ do: 'tap', target: '#go' }` is exactly `tap('#go')`.
A **target** is a selector or `[x, y]` in prototype coordinates.

| `do` | Fields | Default | What it does |
|---|---|---|---|
| `tap` | `target`, `after` | `after: 30` | Move, press, release, ripple, then hold `after` |
| `hover` | `target`, `frames` | `frames: 24` | Move onto it without pressing — reveals `:hover` |
| `press` | `target`, `frames` | `frames: 24` | Press and keep holding; pair with `release` |
| `release` | `after` | `after: 0` | Lift, then hold `after` |
| `longPress` | `target`, `frames`, `after` | `42`, `30` | Press, wait `frames`, release, hold `after` |
| `dragTo` | `target`, `to`, `frames`, `after` | `34`, `20` | Press, move over `frames`, release. `to` is `[x, y]`, `{ dx, dy }` or a selector |
| `swipe` | `target`, `axis`, `delta`, `frames` | `frames: 34` | Scroll a scrollable element by `delta` px along `'x'` or `'y'`; `delta: 'end'` scrolls to the end |
| `hold` | `frames` | — | Rest; animations and the ripple keep running |
| `moveTo` | `x`, `y`, `frames` | `frames: 26` | Reposition the pointer without clicking |
| `fadeOut` | `frames` | `frames: 18` | Fade the pointer out |

`drag` is accepted as the pre-0.2.0 name for `swipe`.

Any step may carry `id` and `note` — strings the engine never interprets, passed
through to `steps.json` so a step can be found by name later.

## Validation

The list is checked before Chrome launches. An unknown verb, a misspelt field, a
missing required field or a bad duration fails immediately, naming the step:

```
steps[3] (tap): unknown field "targett" — tap takes target, after, id, note
```

That is deliberate: a typo should cost a millisecond, not the render it would
otherwise have silently ruined.

## `steps.json`

Alongside `taps.json`, a run from a step list writes `out/steps.json` — each
step with its index, verb, target, `id`/`note` if given, and where it sat on the
frame clock:

```json
{ "i": 1, "do": "tap", "id": "go", "target": "#go", "from": 10, "to": 85 }
```

`from` is the first frame the step produced, `to` the first frame after it, so
`to - from` is the step's length and consecutive steps tile the clip with no
gaps. `record()` returns the same list as `result.steps`. This is the hook a
timeline hangs off: a block per step, re-render from a given step onward.

## Programmatic use

```js
import { record, validateSteps, loadSteps, toFrames, VERBS } from 'protoreel';
```

`validateSteps(list, fps)` returns the normalised list (defaults filled, durations
in frames) or throws; `VERBS` is the schema it checks against.
