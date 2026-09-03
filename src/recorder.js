/* protoreel — frame-stepped prototype recorder (the engine).
 *
 * Nothing is captured in real time. The CSS animation clock is frozen over CDP
 * and `setTimeout` is replaced with a virtual queue; each frame advances both
 * by exactly 1/60 s and takes one screenshot. No dropped frames, no races,
 * byte-identical re-runs. See docs/frame-stepping.md for why both clocks matter.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAC_FFMPEG = '/opt/homebrew/bin/ffmpeg';

/** Resolve a binary: explicit config → env var → known macOS path → PATH. */
export function resolveBin(name, explicit, envVar, macPath) {
  if (explicit) return explicit;
  if (process.env[envVar]) return process.env[envVar];
  if (macPath && fs.existsSync(macPath)) return macPath;
  return name;
}

function ffmpegPath(config) {
  return resolveBin('ffmpeg', config.ffmpegPath, 'PROTOREEL_FFMPEG', MAC_FFMPEG);
}

function ffprobePath(config) {
  const ff = ffmpegPath(config);
  const guess = ff.endsWith('ffmpeg') ? ff.slice(0, -'ffmpeg'.length) + 'ffprobe' : null;
  return resolveBin('ffprobe', config.ffprobePath, 'PROTOREEL_FFPROBE', guess && fs.existsSync(guess) ? guess : null);
}

/** Fail fast on a missing encoder before spending minutes on screenshots. */
export function preflight(config) {
  const ff = ffmpegPath(config);
  try {
    execFileSync(ff, ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `ffmpeg not found (tried "${ff}"). Install it (macOS: brew install ffmpeg) or set config.ffmpegPath / PROTOREEL_FFMPEG.`
    );
  }
  return { ffmpeg: ff, ffprobe: ffprobePath(config) };
}

async function launch(config) {
  const explicit = config.chromePath || process.env.PROTOREEL_CHROME;
  const opts = explicit
    ? { executablePath: explicit }
    : fs.existsSync(MAC_CHROME)
      ? { executablePath: MAC_CHROME }
      : { channel: 'chrome' };
  try {
    return await chromium.launch(opts);
  } catch (e) {
    throw new Error(
      `Could not launch Google Chrome (${JSON.stringify(opts)}). Install Chrome, or point config.chromePath / PROTOREEL_CHROME at a Chromium binary.\n${e.message}`
    );
  }
}

function resolveFrom(base, p) {
  if (!p) return p;
  if (/^https?:/.test(p)) return p;
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

function normalise(config, configDir) {
  const c = { ...config };
  c.view = c.view || { w: 390, h: 844 };
  c.frame = { png: null, stage: null, screen: null, island: null, ...(c.frame || {}) };
  c.frame.png = resolveFrom(configDir, c.frame.png);
  c.source = resolveFrom(configDir, c.source);
  c.pointer = c.pointer || 'touch';
  c.fps = c.fps || 60;
  c.scale = c.scale == null ? 2 : c.scale;
  c.slow = c.slow == null ? 1.0 : c.slow;
  c.outDir = path.resolve(configDir, c.outDir || './out');
  c.frameDir = path.resolve(configDir, c.frameDir || './.frames');
  c.output = c.output || ['webm', 'mp4', 'poster'];
  c.gif = { fps: 24, width: 480, ...(c.gif || {}) };
  if (!c.source) throw new Error('config.source is required — a file path or an http(s) URL');
  if (!c.frame.png) {
    c.frame.stage = null;
    c.frame.screen = null;
    c.frame.island = null;
  } else if (!c.frame.stage || !c.frame.screen) {
    throw new Error('config.frame.png is set, so frame.stage and frame.screen are required — see docs/device-frames.md');
  }
  return c;
}

/**
 * Record a walkthrough.
 * @param {object} config  see examples/walkthrough.config.example.mjs
 * @param {object} [opts]
 * @param {string} [opts.name]       output basename (default 'walkthrough')
 * @param {string} [opts.configDir]  directory relative paths resolve against (default cwd)
 * @param {boolean} [opts.quiet]
 */
export async function record(config, opts = {}) {
  const configDir = opts.configDir || process.cwd();
  const CONFIG = normalise(config, configDir);
  const name = opts.name || CONFIG.name || 'walkthrough';
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);
  if (typeof CONFIG.walkthrough !== 'function') {
    throw new Error('config.walkthrough must be an async function — it receives { tap, drag, hold, moveTo, fadeOut, extent, paint, step, page }');
  }

  const { ffmpeg: FF } = preflight(CONFIG);

  const FPS = CONFIG.fps, DT = 1000 / FPS, SLOW = CONFIG.slow;
  const bare = !CONFIG.frame.png;
  const STAGE = bare ? { w: CONFIG.view.w, h: CONFIG.view.h } : CONFIG.frame.stage;
  const SCREEN = bare ? { x: 0, y: 0, w: CONFIG.view.w, h: CONFIG.view.h, r: 0 } : CONFIG.frame.screen;
  const S = SCREEN.w / CONFIG.view.w;                      // prototype → screen scale
  const frameDir = CONFIG.frameDir;
  const outDir = CONFIG.outDir;
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await launch(CONFIG);
  const page = await browser.newPage({ viewport: { width: STAGE.w, height: STAGE.h }, deviceScaleFactor: CONFIG.scale });

  /* virtual setTimeout — fires only when the frame clock ticks */
  await page.addInitScript(() => {
    const q = []; let now = 0, id = 0;
    window.setTimeout = (fn, ms = 0, ...a) => { q.push({ id: ++id, at: now + ms, fn, a }); return id; };
    window.clearTimeout = (i) => { const k = q.findIndex(t => t.id === i); if (k >= 0) q.splice(k, 1); };
    window.__vtick = (dt) => {
      now += dt;
      q.sort((a, b) => a.at - b.at);
      while (q.length && q[0].at <= now) { const t = q.shift(); try { t.fn(...t.a); } catch (e) { console.error(e); } }
    };
  });

  const url = /^https?:/.test(CONFIG.source) ? CONFIG.source : 'file://' + CONFIG.source;
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  /* stage: frame image behind, prototype scaled into the screen slot */
  const dev = CONFIG.deviceSelector || 'body';
  let css = `
    html, body { width: ${STAGE.w}px; height: ${STAGE.h}px; margin: 0; overflow: hidden; }
    #pc-tf, #pc-tr { position: absolute; left: 0; top: 0; width: 40px; height: 40px; margin: -20px 0 0 -20px;
      border-radius: 50%; pointer-events: none; z-index: 2147483000; opacity: 0; will-change: transform, opacity; }
    #pc-tf { background: rgba(40,38,32,.22); border: 1.5px solid rgba(255,255,255,.75); box-shadow: 0 1px 6px rgba(0,0,0,.18); }
    #pc-tr { border: 2px solid rgba(40,38,32,.5); }
  `;
  if (!bare) {
    const bg = 'data:image/png;base64,' + fs.readFileSync(CONFIG.frame.png).toString('base64');
    css += `
    body { background: url(${bg}) 0 0 / ${STAGE.w}px ${STAGE.h}px no-repeat !important; }
    ${dev} {
      position: absolute !important; left: ${SCREEN.x}px !important; top: ${SCREEN.y}px !important;
      width: ${CONFIG.view.w}px !important; height: ${SCREEN.h / S}px !important;
      transform: scale(${S}); transform-origin: 0 0; box-shadow: none !important;
      border-radius: ${SCREEN.r / S}px; overflow: hidden;
    }`;
    if (CONFIG.frame.island) {
      const i = CONFIG.frame.island;
      css += `\n  #pc-island { position: absolute; left: ${i.x}px; top: ${i.y}px; width: ${i.w}px; height: ${i.h}px;
        border-radius: 9999px; background: #1e1e1f; z-index: 2147482000; pointer-events: none; }`;
    }
  }
  await page.addStyleTag({ content: css });
  await page.evaluate(([devSel, island]) => {
    if (island) { const el = document.createElement('div'); el.id = 'pc-island'; document.body.appendChild(el); }
    const host = document.querySelector(devSel) || document.body;
    for (const id of ['pc-tr', 'pc-tf']) { const d = document.createElement('div'); d.id = id; host.appendChild(d); }
    window.__touch = (x, y, s, o) => { const f = document.getElementById('pc-tf'); f.style.transform = `translate(${x}px,${y}px) scale(${s})`; f.style.opacity = o; };
    window.__ring = (x, y, s, o) => { const r = document.getElementById('pc-tr'); r.style.transform = `translate(${x}px,${y}px) scale(${s})`; r.style.opacity = o; };
  }, [dev, !bare && CONFIG.frame.island]);

  if (CONFIG.pointer === 'cursor') {
    await page.addStyleTag({ content: `
      #pc-tf { width: 0; height: 0; margin: 0; border-radius: 0; background: none; border: none; box-shadow: none;
        border-left: 12px solid #1c1c1c; border-bottom: 8px solid transparent; border-right: 8px solid transparent;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); transform-origin: 0 0; }` });
  }
  if (CONFIG.pointer === 'none') await page.addStyleTag({ content: `#pc-tf, #pc-tr { display: none !important; }` });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });

  /* ---------- frame clock ---------- */
  let n = 0;
  const tick = async () => {
    await page.evaluate((dt) => {
      document.getAnimations().forEach(a => { a.currentTime = (a.currentTime || 0) + dt; });
      window.__vtick(dt);
    }, DT);
    await page.screenshot({ path: path.join(frameDir, String(n++).padStart(5, '0') + '.png') });
  };

  /* ---------- pointer ---------- */
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const taps = [];
  let fx = CONFIG.view.w / 2, fy = CONFIG.view.h + 80, fo = 0, ring = null;
  const RING_F = 30;                                   // ripple lifetime, frames
  const paint = async () => {
    await page.evaluate(([x, y, o, r]) => {
      window.__touch(x, y, 1, o);
      if (r) {
        const p = r.t, ei = Math.min(1, p / 0.22), eo = Math.max(0, (p - 0.22) / 0.78);
        window.__ring(r.x, r.y, 0.7 + 1.3 * (1 - Math.pow(1 - p, 3)), 0.9 * (1 - Math.pow(1 - ei, 2)) * (1 - eo * eo));
      } else window.__ring(0, 0, 1, 0);
    }, [fx, fy, fo, ring]);
  };
  // step() drives BOTH the ripple and the frame clock — hold() must call it,
  // or the ripple freezes mid-bloom and resumes on the next pointer move.
  const step = async () => { if (ring) { ring.t += 1 / RING_F; if (ring.t >= 1) ring = null; } await paint(); await tick(); };
  const hold = async (f) => { for (let i = 0; i < Math.round(f * SLOW); i++) await step(); };

  const centre = async (sel) => page.evaluate(([s, d, vw]) => {
    const el = document.querySelector(s); if (!el) throw new Error('no such element: ' + s);
    const r = el.getBoundingClientRect();
    const host = (document.querySelector(d) || document.body).getBoundingClientRect();
    const sc = host.width / vw;
    return [(r.left + r.width / 2 - host.left) / sc, (r.top + r.height / 2 - host.top) / sc];
  }, [sel, dev, CONFIG.view.w]);

  const visible = async (sel) => page.evaluate(([s, d]) => {
    const el = document.querySelector(s); if (!el) return false;
    const r = el.getBoundingClientRect();
    const h = (document.querySelector(d) || document.body).getBoundingClientRect();
    return r.left >= h.left + 6 && r.right <= h.right - 6 && r.top >= h.top + 6 && r.bottom <= h.bottom - 6;
  }, [sel, dev]);

  const moveTo = async (x, y, frames = 26, fadeIn = false) => {
    frames = Math.round(frames * SLOW);
    const x0 = fx, y0 = fy, o0 = fo, dx = x - x0, dy = y - y0;
    const len = Math.hypot(dx, dy) || 1, bend = Math.min(18, len * 0.08);
    for (let i = 1; i <= frames; i++) {
      const t = easeInOut(i / frames), s = Math.sin(t * Math.PI);
      fx = x0 + dx * t - (dy / len) * bend * s;
      fy = y0 + dy * t + (dx / len) * bend * s;
      if (fadeIn) fo = Math.min(1, o0 + (1 - o0) * easeOut(Math.min(1, i / (frames * 0.5))));
      await step();
    }
  };

  const tap = async (sel, after = 30) => {
    if (!(await visible(sel))) throw new Error(`tap target off-screen: ${sel} — scroll or swipe to it first`);
    const [x, y] = await centre(sel);
    await moveTo(x, y, 24, fo < 1);
    for (let i = 1; i <= 5; i++) {                                  // press
      await page.evaluate(([a, b, s]) => window.__touch(a, b, s, 1), [fx, fy, 1 - 0.18 * (i / 5)]);
      await tick();
    }
    await page.evaluate((s) => document.querySelector(s).click(), sel);
    ring = { x: fx, y: fy, t: 0 };
    taps.push({ sel, frame: n, x: Math.round(fx), y: Math.round(fy) });
    for (let i = 0; i < 5; i++) await step();
    await hold(after);
  };

  const drag = async (sel, axis, delta, frames = 34) => {
    frames = Math.round(frames * SLOW);
    const [cx, cy] = await centre(sel);
    await moveTo(axis === 'x' ? cx + 120 : cx, axis === 'y' ? cy + 120 : cy, 18, fo < 1);
    await hold(4);
    const prop = axis === 'y' ? 'scrollTop' : 'scrollLeft';
    const start = await page.evaluate(([s, p]) => document.querySelector(s)[p], [sel, prop]);
    const x0 = fx, y0 = fy;
    for (let i = 1; i <= frames; i++) {
      const d = delta * easeInOut(i / frames);
      if (axis === 'y') fy = y0 - d; else fx = x0 - d;
      await page.evaluate(([s, p, v]) => { document.querySelector(s)[p] = v; }, [sel, prop, start + d]);
      await step();
    }
  };

  // scrollable extent, for swiping a row exactly to its end rather than guessing
  const extent = (sel, axis = 'x') => page.evaluate(([s, a]) => {
    const e = document.querySelector(s);
    return a === 'x' ? e.scrollWidth - e.clientWidth : e.scrollHeight - e.clientHeight;
  }, [sel, axis]);

  const fadeOut = async (frames = 18) => { for (let i = 1; i <= frames; i++) { fo = 1 - easeInOut(i / frames); await step(); } };

  /* ---------- the walkthrough ---------- */
  try {
    await CONFIG.walkthrough({ tap, drag, hold, moveTo, fadeOut, extent, paint, step, tick, page, config: CONFIG });
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(outDir, 'taps.json'), JSON.stringify(taps, null, 1));
  log('frames', n, `(${(n / FPS).toFixed(1)}s)`, '· taps', taps.length);

  /* ---------- encode ---------- */
  const seq = path.join(frameDir, '%05d.png');
  const inp = ['-y', '-v', 'error', '-framerate', String(FPS), '-i', seq];
  const want = new Set(CONFIG.output);
  const files = {};

  if (want.has('webm')) {
    const webm = path.join(outDir, name + '.webm');
    execFileSync(FF, [...inp, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '26', '-pass', '1', '-an', '-pix_fmt', 'yuv420p', '-f', 'null', '/dev/null'], { cwd: outDir, stdio: 'inherit' });
    execFileSync(FF, [...inp, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '26', '-pass', '2', '-an', '-pix_fmt', 'yuv420p', '-row-mt', '1', webm], { cwd: outDir, stdio: 'inherit' });
    fs.rmSync(path.join(outDir, 'ffmpeg2pass-0.log'), { force: true });
    files.webm = webm;
  }
  if (want.has('mp4')) {
    const mp4 = path.join(outDir, name + '.mp4');
    execFileSync(FF, [...inp, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
    files.mp4 = mp4;
  }
  if (want.has('poster')) {
    const poster = path.join(outDir, name + '-poster.jpg');
    const posterFrame = String(CONFIG.posterFrame || 0).padStart(5, '0');
    execFileSync(FF, ['-y', '-v', 'error', '-i', path.join(frameDir, posterFrame + '.png'), '-q:v', '4', poster], { stdio: 'inherit' });
    files.poster = poster;
  }
  if (want.has('gif')) {
    // two passes with a palette, or the result is 256-colour mush — see docs/encoding.md
    const gif = path.join(outDir, name + '.gif');
    const pal = path.join(outDir, name + '-palette.png');
    const vf = `fps=${CONFIG.gif.fps},scale=${CONFIG.gif.width}:-1:flags=lanczos`;
    execFileSync(FF, ['-y', '-v', 'error', '-framerate', String(FPS), '-i', seq, '-vf', `${vf},palettegen=stats_mode=diff`, pal], { stdio: 'inherit' });
    execFileSync(FF, ['-y', '-v', 'error', '-framerate', String(FPS), '-i', seq, '-i', pal, '-lavfi', `${vf} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3`, gif], { stdio: 'inherit' });
    fs.rmSync(pal, { force: true });
    files.gif = gif;
  }

  for (const f of Object.values(files)) log(path.basename(f), (fs.statSync(f).size / 1024).toFixed(0) + ' KB');
  return { frames: n, seconds: n / FPS, taps, files, frameDir, outDir };
}

/**
 * List the interactive elements on the page, so a walkthrough references real
 * selectors instead of guesses. Prefers stable hooks (#id, [data-*]) over nth-child.
 */
export async function inspect(config, opts = {}) {
  const configDir = opts.configDir || process.cwd();
  const CONFIG = normalise(config, configDir);
  const browser = await launch(CONFIG);
  const page = await browser.newPage({ viewport: { width: CONFIG.view.w, height: CONFIG.view.h } });
  const url = /^https?:/.test(CONFIG.source) ? CONFIG.source : 'file://' + CONFIG.source;
  await page.goto(url, { waitUntil: 'load' });
  const list = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    const push = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const data = {};
      for (const a of el.attributes) if (a.name.startsWith('data-')) data[a.name] = a.value;
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        class: el.className && typeof el.className === 'string' ? el.className : undefined,
        data: Object.keys(data).length ? data : undefined,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || undefined,
      });
    };
    document.querySelectorAll('button, a, [role=button], input, select, textarea, [onclick], [tabindex]').forEach(push);
    document.querySelectorAll('*').forEach(el => { for (const a of el.attributes) if (a.name.startsWith('data-')) { push(el); break; } });
    return out;
  });
  await browser.close();
  return list;
}
