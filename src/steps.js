/* protoreel — steps as data.
 *
 * A walkthrough can be a JSON step list instead of an async function:
 *
 *   steps: [
 *     { do: 'hold', frames: 45 },
 *     { do: 'tap', target: '#openFilters', after: '800ms' },
 *     { do: 'dragTo', target: '#handle', to: { dx: 90 }, frames: 40 },
 *     { do: 'fadeOut' }, { do: 'hold', frames: 60 },
 *   ]
 *
 * Both forms drive the same verbs, so a step list renders byte-identical to the
 * equivalent function. The list is validated before Chrome launches — a typo in
 * step 7 should cost a millisecond, not a five-minute render. Nothing in this
 * file touches the browser. See docs/steps.md.
 */
import fs from 'fs';
import path from 'path';

/* verb → required fields, and optional fields with their defaults. The defaults
 * are the verbs' own, so { do: 'tap', target } means exactly tap(target). */
export const VERBS = {
  tap:       { req: ['target'],                 opt: { after: 30 } },
  hover:     { req: ['target'],                 opt: { frames: 24 } },
  press:     { req: ['target'],                 opt: { frames: 24 } },
  release:   { req: [],                         opt: { after: 0 } },
  longPress: { req: ['target'],                 opt: { frames: 42, after: 30 } },
  dragTo:    { req: ['target', 'to'],           opt: { frames: 34, after: 20 } },
  swipe:     { req: ['target', 'axis', 'delta'], opt: { frames: 34 } },
  hold:      { req: ['frames'],                 opt: {} },
  moveTo:    { req: ['x', 'y'],                 opt: { frames: 26 } },
  fadeOut:   { req: [],                         opt: { frames: 18 } },
};
const ALIASES = { drag: 'swipe' };          // pre-0.2.0 name, same as the verb alias
const META = ['id', 'note'];                // carried through to steps.json, never interpreted
const DURATIONS = ['frames', 'after'];

/** A duration is a number of frames, or a time string: '500ms', '1.5s'. */
export function toFrames(v, fps, where = 'duration') {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) throw new Error(`${where}: frames must be a non-negative number — got ${v}`);
    return v;
  }
  if (typeof v === 'string') {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*$/.exec(v);
    if (!m) throw new Error(`${where}: a duration is a number of frames or a time like '500ms' or '1.5s' — got "${v}"`);
    const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
    return Math.round(ms * fps / 1000);
  }
  throw new Error(`${where}: a duration is a number of frames or a time like '500ms' or '1.5s' — got ${JSON.stringify(v)}`);
}

const isPoint = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const isTarget = (v) => (typeof v === 'string' && v.length > 0) || isPoint(v);

/**
 * Resolve config.steps: an array is used as is; a string is a path to a JSON
 * file holding an array, or an object with a `steps` array.
 */
export function loadSteps(spec, configDir = process.cwd()) {
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'string') {
    const file = path.isAbsolute(spec) ? spec : path.resolve(configDir, spec);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(`config.steps: could not read ${file} — ${e.message}`); }
    const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.steps) ? parsed.steps : null;
    if (!list) throw new Error(`config.steps: ${file} must hold an array of steps, or { "steps": [...] }`);
    return list;
  }
  throw new Error('config.steps must be an array of steps or a path to a .json file');
}

/**
 * Check every step and fill in defaults. Returns a new list; throws naming the
 * offending step. Durations come back as frames.
 */
export function validateSteps(steps, fps = 60) {
  if (!Array.isArray(steps)) throw new Error('config.steps must be an array');
  if (!steps.length) throw new Error('config.steps is empty — a walkthrough needs at least one step');
  return steps.map((raw, i) => {
    const at = `steps[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${at}: a step is an object like { do: 'tap', target: '#id' }`);
    const verb = ALIASES[raw.do] || raw.do;
    const spec = VERBS[verb];
    if (!spec) {
      throw new Error(`${at}: unknown verb ${JSON.stringify(raw.do)} — expected one of ${Object.keys(VERBS).join(', ')}`);
    }
    const allowed = new Set(['do', ...spec.req, ...Object.keys(spec.opt), ...META]);
    for (const k of Object.keys(raw)) {
      if (!allowed.has(k)) throw new Error(`${at} (${verb}): unknown field "${k}" — ${verb} takes ${[...allowed].filter(x => x !== 'do').join(', ')}`);
    }
    for (const k of spec.req) {
      if (raw[k] === undefined) throw new Error(`${at} (${verb}): "${k}" is required`);
    }
    const s = { do: verb, ...spec.opt };
    for (const k of [...spec.req, ...Object.keys(spec.opt), ...META]) if (raw[k] !== undefined) s[k] = raw[k];

    for (const k of DURATIONS) if (s[k] !== undefined) s[k] = toFrames(s[k], fps, `${at} (${verb}) ${k}`);
    if ('target' in s && !isTarget(s.target)) throw new Error(`${at} (${verb}): target must be a selector or [x, y] — got ${JSON.stringify(s.target)}`);
    if (verb === 'dragTo') {
      const to = s.to;
      const rel = to && typeof to === 'object' && !Array.isArray(to) && (Number.isFinite(to.dx) || Number.isFinite(to.dy));
      if (!(isTarget(to) || rel)) throw new Error(`${at} (dragTo): "to" must be [x, y], { dx, dy } or a selector — got ${JSON.stringify(to)}`);
    }
    if (verb === 'swipe') {
      if (s.axis !== 'x' && s.axis !== 'y') throw new Error(`${at} (swipe): axis must be 'x' or 'y' — got ${JSON.stringify(s.axis)}`);
      if (typeof s.target !== 'string') throw new Error(`${at} (swipe): target must be a selector (the scrollable element)`);
      if (!(Number.isFinite(s.delta) || s.delta === 'end')) throw new Error(`${at} (swipe): delta must be a number of px or 'end' — got ${JSON.stringify(s.delta)}`);
    }
    if (verb === 'moveTo' && !(Number.isFinite(s.x) && Number.isFinite(s.y))) throw new Error(`${at} (moveTo): x and y must be numbers`);
    for (const k of META) if (s[k] !== undefined && typeof s[k] !== 'string') throw new Error(`${at}: "${k}" must be a string`);
    return s;
  });
}

/**
 * Drive the verbs with a validated step list. Returns the step log: where each
 * step started and ended on the frame clock — what a timeline needs.
 * `verbs` is the object record() passes to walkthrough(); it must include frame().
 */
export async function runSteps(steps, verbs) {
  const log = [];
  await verbs.paint();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const from = verbs.frame();
    switch (s.do) {
      case 'tap':       await verbs.tap(s.target, s.after); break;
      case 'hover':     await verbs.hover(s.target, s.frames); break;
      case 'press':     await verbs.press(s.target, s.frames); break;
      case 'release':   await verbs.release(s.after); break;
      case 'longPress': await verbs.longPress(s.target, s.frames, s.after); break;
      case 'dragTo':    await verbs.dragTo(s.target, s.to, s.frames, s.after); break;
      case 'swipe': {
        const d = s.delta === 'end' ? await verbs.extent(s.target, s.axis) : s.delta;
        await verbs.swipe(s.target, s.axis, d, s.frames);
        break;
      }
      case 'hold':      await verbs.hold(s.frames); break;
      case 'moveTo':    await verbs.moveTo(s.x, s.y, s.frames); break;
      case 'fadeOut':   await verbs.fadeOut(s.frames); break;
      default: throw new Error(`steps[${i}]: unknown verb ${s.do}`);   // validateSteps makes this unreachable
    }
    const entry = { i, do: s.do };
    if (s.id) entry.id = s.id;
    if (s.target !== undefined) entry.target = s.target;
    entry.from = from;
    entry.to = verbs.frame();
    if (s.note) entry.note = s.note;
    log.push(entry);
  }
  return log;
}
