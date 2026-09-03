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
const { default: config } = await import(pathToFileURL(path.join(here, 'fixture.config.mjs')).href);

const EXPECT_FRAMES = 100;
const EXPECT_TAP_FRAME = 10 + 24 + 5;   // hold + moveTo + press ticks

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok  ' : '  FAIL') + ' ' + msg); if (!ok) failures++; };

const hashFrames = (dir) => fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()
  .map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]);

console.log('run 1');
const r1 = await record(config, { configDir: here, name: 'fixture', quiet: true });
const h1 = hashFrames(r1.frameDir);

check(r1.frames === EXPECT_FRAMES, `frame count ${r1.frames} (expected ${EXPECT_FRAMES})`);
const taps = JSON.parse(fs.readFileSync(path.join(r1.outDir, 'taps.json'), 'utf8'));
check(taps.length === 1 && taps[0].sel === '#go', `taps.json has one tap on #go`);
check(taps[0]?.frame === EXPECT_TAP_FRAME, `tap landed on frame ${taps[0]?.frame} (expected ${EXPECT_TAP_FRAME})`);

// clocks tick: the box is mid-transition at frames 41..50, so they must differ;
// everything has settled by frame 90 (ripple done, pointer faded), so 98 == 99.
const byName = Object.fromEntries(h1);
check(byName['00041.png'] !== byName['00050.png'], 'frames differ while the transition runs (animation clock ticks)');
check(byName['00098.png'] === byName['00099.png'], 'frames identical once settled (nothing runs on a wall clock)');

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

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
