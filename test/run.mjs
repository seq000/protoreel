/* End-to-end check: record the fixture twice and assert the things the README
 * claims — exact frame count, taps.json, the ffprobe spec of the output, that
 * the clocks actually tick (frames change during a transition and settle
 * after), and that a re-run is byte-identical.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { record, preflight } from '../src/recorder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: config, probe } = await import(pathToFileURL(path.join(here, 'fixture.config.mjs')).href);

const EXPECT_FRAMES = 180;
const EXPECT_TAP_FRAME = 10 + 24 + 5;   // hold + moveTo + squash ticks, then pointerdown
const DT = 1000 / 60;

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok  ' : '  FAIL') + ' ' + msg); if (!ok) failures++; };

const hashFrames = (dir) => fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()
  .map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]);

console.log('run 1');
const r1 = await record(config, { configDir: here, name: 'fixture', quiet: true });
const h1 = hashFrames(r1.frameDir);

check(r1.frames === EXPECT_FRAMES, `frame count ${r1.frames} (expected ${EXPECT_FRAMES})`);
const taps = JSON.parse(fs.readFileSync(path.join(r1.outDir, 'taps.json'), 'utf8'));
check(taps.length === 2 && taps[0].sel === '#go' && taps[1].sel === '#handle', 'taps.json records the tap and the drag press');
check(taps[0]?.frame === EXPECT_TAP_FRAME, `tap landed on frame ${taps[0]?.frame} (expected ${EXPECT_TAP_FRAME})`);

/* Real input: none of this responds to element.click(). A handle that moved is
 * proof the page received trusted pointerdown/move/up with pointer capture. */
check(probe.beforeDrag.handleX === 0, `handle starts at 0 (was ${probe.beforeDrag.handleX})`);
check(probe.afterDrag.handleX === 150, `handle dragged to 150 (was ${probe.afterDrag.handleX})`);
check(probe.end.count === '1', `the tap fired the click handler and its virtual setTimeout (count ${probe.end.count})`);

/* Every clock reads the frame clock, not the wall clock. At the last frame
 * exactly EXPECT_FRAMES ticks have run, so each of these is arithmetic, not a
 * measurement — ±1 only to absorb float rounding in the page's Math.round. */
const near = (a, b, t = 1) => Math.abs(a - b) <= t;
check(near(probe.end.perf, EXPECT_FRAMES * DT), `performance.now ${probe.end.perf}ms (expected ${Math.round(EXPECT_FRAMES * DT)})`);
check(probe.end.raf === EXPECT_FRAMES, `requestAnimationFrame ran once per frame: ${probe.end.raf} (expected ${EXPECT_FRAMES})`);
check(probe.end.interval === 30, `setInterval(100ms) fired ${probe.end.interval} times in 3s (expected 30)`);
check(probe.end.date === '09:41:03', `Date starts at the configured 09:41:00 and advances 3s → ${probe.end.date}`);

// The box transitions just after the pointer lifts, so 41..50 must differ; the
// handle is mid-drag at 120..130; by 177 everything has settled — ripple gone,
// pointer faded — so consecutive tail frames must be byte-identical, which is
// what proves nothing is quietly running on a wall clock.
const byName = Object.fromEntries(h1);
check(byName['00041.png'] !== byName['00050.png'], 'frames differ while the transition runs (animation clock ticks)');
check(byName['00120.png'] !== byName['00130.png'], 'frames differ while the handle is being dragged');
check(byName['00177.png'] === byName['00178.png'], 'frames identical once settled (nothing runs on a wall clock)');

// ffprobe the artefact, not the command
const { ffprobe } = preflight(config);
for (const [file, codec] of [[r1.files.mp4, 'h264'], [r1.files.webm, 'vp9']]) {
  const out = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,pix_fmt,nb_frames', '-show_entries', 'format=duration',
    '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const s = j.streams[0];
  const dur = Number(j.format.duration);
  check(s.codec_name === codec, `${path.basename(file)} codec ${s.codec_name}`);
  check(s.width === 320 && s.height === 240, `${path.basename(file)} ${s.width}×${s.height}`);
  check(s.r_frame_rate === '60/1', `${path.basename(file)} frame rate ${s.r_frame_rate}`);
  check(s.pix_fmt === 'yuv420p', `${path.basename(file)} pix_fmt ${s.pix_fmt}`);
  check(Math.abs(dur - EXPECT_FRAMES / 60) < 0.05, `${path.basename(file)} duration ${dur.toFixed(3)}s (expected ${(EXPECT_FRAMES / 60).toFixed(3)})`);
}
check(fs.existsSync(r1.files.poster) && fs.statSync(r1.files.poster).size > 0, 'poster written');

console.log('run 2');
const r2 = await record(config, { configDir: here, name: 'fixture', quiet: true });
const h2 = hashFrames(r2.frameDir);
const same = h1.length === h2.length && h1.every(([f, h], i) => h2[i][0] === f && h2[i][1] === h);
check(same, `re-run is byte-identical across all ${h1.length} frames`);

/* Steps as data. fixture.steps.json is the same walkthrough written as JSON —
 * if the two forms drive the same verbs, every frame must match run 1. */
console.log('run 3 — steps as data');
const { walkthrough: _fn, ...settings } = config;
const r3 = await record({ ...settings, steps: './fixture.steps.json' }, { configDir: here, name: 'fixture-steps', quiet: true });
const h3 = hashFrames(r3.frameDir);
const sameAsFn = h1.length === h3.length && h1.every(([f, h], i) => h3[i][0] === f && h3[i][1] === h);
check(sameAsFn, `JSON step list renders byte-identical to the function form (${h3.length} frames)`);
const stepLog = JSON.parse(fs.readFileSync(path.join(r3.outDir, 'steps.json'), 'utf8'));
check(stepLog.length === 5 && stepLog[1].id === 'go' && stepLog[1].do === 'tap', 'steps.json lists every step with its id and verb');
check(stepLog[1].from === 10 && stepLog[1].to === 85, `tap step spans frames ${stepLog[1]?.from}–${stepLog[1]?.to} (expected 10–85)`);
check(stepLog[2].from === 85 && stepLog[2].to === 164, `dragTo step spans frames ${stepLog[2]?.from}–${stepLog[2]?.to} (expected 85–164; after '167ms' = 10 frames)`);
check(stepLog[4].to === r3.frames && stepLog[4].note === 'settle', 'last step ends on the final frame; note carried through');
check(JSON.stringify(r3.steps) === JSON.stringify(stepLog), 'record() returns the same step log it wrote');

// Bad lists fail before Chrome launches, naming the step.
const rejects = async (steps, re) => { try { await record({ ...settings, steps }, { configDir: here, quiet: true }); return false; } catch (e) { return re.test(e.message); } };
check(await rejects([{ do: 'tapp', target: '#go' }], /steps\[0\]: unknown verb "tapp"/), 'unknown verb is rejected with the step index');
check(await rejects([{ do: 'tap', targett: '#go' }], /steps\[0\] \(tap\): unknown field "targett"/), 'misspelt field is rejected');
check(await rejects([{ do: 'hold', frames: '1 minute' }], /a duration is a number of frames or a time/), 'bad duration string is rejected');
check(await rejects([{ do: 'tap', target: '#go' }, { do: 'swipe', target: '#l', axis: 'z', delta: 10 }], /steps\[1\] \(swipe\): axis/), 'swipe axis is checked');
try { await record({ ...config, steps: [] }, { configDir: here, quiet: true }); check(false, 'both forms rejected'); }
catch (e) { check(/both steps and walkthrough/.test(e.message), 'config with both steps and walkthrough is rejected'); }

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
