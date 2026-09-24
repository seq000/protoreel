/* protoreel — frame-stepped prototype recorder (the engine).
 *
 * Nothing is captured in real time. Every clock the page can read is frozen and
 * advanced by exactly 1/60 s per screenshot: the CSS/WAAPI clock over CDP, and
 * setTimeout, setInterval, requestAnimationFrame, performance.now and Date in
 * the page. No dropped frames, no races, byte-identical re-runs.
 *
 * Input is real. Pointer actions drive Chrome's own input pipeline over CDP, so
 * the page receives trusted events — pointer capture, hover and drag handlers
 * all behave as they do for a human. See docs/frame-stepping.md (time) and
 * docs/pointer-input.md (input).
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
  // The wall-clock instant the page believes it is. Fixed by default so a clock
  // or an ETA rendered on screen is deliberate and identical between runs —
  // pass clock: false to leave the page's Date alone.
  // Which pointer gets drawn when pointer: 'cursor'. Light UI wants the white
  // arrow; a dark prototype reads better with the inverted one.
  c.cursor = c.cursor || 'macos';
  const CURSOR_STYLES = ['macos', 'macos-dark'];
  if (!CURSOR_STYLES.includes(c.cursor)) {
    throw new Error(`config.cursor must be one of ${CURSOR_STYLES.join(', ')} — got "${c.cursor}"`);
  }
  c.clock = c.clock === false ? false : { start: '2026-01-01T09:41:00', ...(c.clock || {}) };
  if (c.clock) {
    const t = new Date(c.clock.start).getTime();
    if (Number.isNaN(t)) throw new Error(`config.clock.start is not a valid date: ${c.clock.start}`);
    c.clock.epoch = t;
  }
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
    throw new Error('config.walkthrough must be an async function — it receives { tap, hover, press, release, dragTo, longPress, swipe, hold, moveTo, fadeOut, extent, paint, step, page }');
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

  /* ---------- virtual clocks ----------
   * Installed before load, deliberately: a library that captures
   * requestAnimationFrame or Date at module scope must capture these, not the
   * real ones. Everything below advances only when __vtick runs, once per frame.
   *
   * Leave any of these real and the page runs at wall-clock speed while each
   * screenshot costs ~130 ms — a drive simulation overshoots its route, a
   * timeline scrubs itself, an on-screen clock drifts minutes across a clip
   * whose own countdown says seconds. See docs/frame-stepping.md.
   */
  await page.addInitScript(({ clock, fps }) => {
    const timers = [];                  // setTimeout + setInterval
    const raf = [];                     // requestAnimationFrame
    let now = 0, ticks = 0, id = 0, rid = 0;

    window.setTimeout = (fn, ms = 0, ...a) => { timers.push({ id: ++id, at: now + ms, fn, a }); return id; };
    window.setInterval = (fn, ms = 0, ...a) => { timers.push({ id: ++id, at: now + ms, every: Math.max(1, ms), fn, a }); return id; };
    window.clearTimeout = window.clearInterval =
      (i) => { const k = timers.findIndex(t => t.id === i); if (k >= 0) timers.splice(k, 1); };

    window.requestAnimationFrame = (fn) => { raf.push({ id: ++rid, fn }); return rid; };
    window.cancelAnimationFrame = (i) => { const k = raf.findIndex(r => r.id === i); if (k >= 0) raf.splice(k, 1); };

    // performance.now is a getter on a prototype in some builds — define, don't assign.
    try { Object.defineProperty(window.performance, 'now', { value: () => now, configurable: true }); }
    catch { window.performance.now = () => now; }

    if (clock) {
      const RealDate = Date;
      const virtual = () => clock.epoch + now;
      function VDate(...a) {
        if (!(this instanceof VDate)) return new RealDate(virtual()).toString();
        return a.length ? new RealDate(...a) : new RealDate(virtual());
      }
      VDate.prototype = RealDate.prototype;
      VDate.now = virtual;
      VDate.parse = RealDate.parse;
      VDate.UTC = RealDate.UTC;
      window.Date = VDate;
    }

    window.__vtick = () => {
      // Computed from the frame count, never accumulated. `now += dt` drifts:
      // 1000/60 is not representable, and 180 additions of it land on
      // 2999.9999999999995 — which is enough to make a 100 ms interval miss its
      // 30th fire and a clock read 09:41:02 instead of 03. ticks * 1000 / fps
      // is exact integer arithmetic for any integer fps.
      ticks++;
      now = ticks * 1000 / fps;
      // Timers first: a callback may schedule a frame, and that frame should
      // run in this tick rather than lagging one behind.
      timers.sort((a, b) => a.at - b.at);
      for (let guard = 0; guard < 1000; guard++) {
        const t = timers[0];
        if (!t || t.at > now) break;
        if (t.every) { t.at += t.every; timers.sort((a, b) => a.at - b.at); }
        else timers.shift();
        try { t.fn(...t.a); } catch (e) { console.error(e); }
      }
      for (const r of raf.splice(0, raf.length)) { try { r.fn(now); } catch (e) { console.error(e); } }
    };
  }, { clock: CONFIG.clock, fps: FPS });

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
    /* A drawn macOS pointer, not a CSS triangle: white fill, dark outline and a
     * soft shadow, so it reads on light and dark UI alike. The arrow's hotspot
     * is its tip at (0,0); the hands are offset so the grab point sits under
     * the same coordinate, which is what keeps the pointer from jumping when it
     * changes shape mid-drag. */
    const CURSORS = {
      macos: {
        fill: '#fff', stroke: '#1c1c1e',
        arrow: 'M1,1 L1,20.5 L6.1,15.6 L9.2,22.4 L12.4,20.9 L9.4,14.3 L16.2,14.1 Z',
      },
      'macos-dark': {
        fill: '#1c1c1e', stroke: '#fff',
        arrow: 'M1,1 L1,20.5 L6.1,15.6 L9.2,22.4 L12.4,20.9 L9.4,14.3 L16.2,14.1 Z',
      },
    };
    const C = CURSORS[CONFIG.cursor] || CURSORS.macos;
    // Open hand and closed fist, built from rounded shapes — they survive being
    // 18px tall far better than a single traced outline does.
    const hand = (closed) => `
      <svg width="26" height="28" viewBox="0 0 26 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g fill="${C.fill}" stroke="${C.stroke}" stroke-width="1.3" stroke-linejoin="round">
          <rect x="6.6" y="${closed ? 11.6 : 2.2}" width="4" height="${closed ? 6 : 15}" rx="2"/>
          <rect x="10.4" y="${closed ? 10.8 : 1}" width="4" height="${closed ? 6.6 : 16}" rx="2"/>
          <rect x="14.2" y="${closed ? 11.4 : 2.6}" width="4" height="${closed ? 6.2 : 14}" rx="2"/>
          <rect x="17.9" y="${closed ? 12.4 : 5}" width="3.8" height="${closed ? 5.4 : 12}" rx="1.9"/>
          <path d="M6.7 ${closed ? 12 : 9.5} C4.4 ${closed ? 11.2 : 8.6} 2.6 ${closed ? 12.6 : 10.2} 3.3 ${closed ? 14.4 : 12.2}
                   L5.6 ${closed ? 18 : 16.4}"/>
          <path d="M3.4 ${closed ? 13.6 : 12} v4.2 c0 4.4 3.3 8.4 8 8.4 h2.2 c4.3 0 7.5-3.1 7.5-7.6 v-3.4"/>
        </g>
      </svg>`;
    const arrowSvg = `
      <svg width="20" height="26" viewBox="0 0 20 26" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="${C.arrow}" fill="${C.fill}" stroke="${C.stroke}" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>`;

    await page.addStyleTag({ content: `
      #pc-tf { width: auto; height: auto; margin: 0; border-radius: 0; background: none; border: none;
        box-shadow: none; transform-origin: 0 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,.32)); }
      #pc-tf > svg { position: absolute; left: 0; top: 0; display: none; }
      #pc-tf > svg.on { display: block; }
      #pc-tf > .pc-hand { margin-left: -12px; margin-top: -13px; }
      /* A light pulse, not the touch ring: a soft bloom that reads as a click
         without leaving a dark halo on a desktop UI. */
      #pc-tr { width: 34px; height: 34px; margin: -17px 0 0 -17px; border: none;
        background: radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,.55) 42%, rgba(255,255,255,0) 72%);
        mix-blend-mode: plus-lighter; }` });

    await page.evaluate(([arrow, open, closed]) => {
      const f = document.getElementById('pc-tf');
      f.innerHTML = arrow + open + closed;
      const [a, o, c] = f.children;
      a.classList.add('on');
      o.classList.add('pc-hand');
      c.classList.add('pc-hand');
      // 'arrow' | 'open' | 'grab' — press/release drive this.
      window.__cursor = (kind) => {
        a.classList.toggle('on', kind === 'arrow');
        o.classList.toggle('on', kind === 'open');
        c.classList.toggle('on', kind === 'grab');
      };
    }, [arrowSvg, hand(false), hand(true)]);
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
  // Assigned once the input layer below exists; moveTo runs before it in source
  // order but never before it in time.
  let sendMove = null;
  const taps = [];
  let fx = CONFIG.view.w / 2, fy = CONFIG.view.h + 80, fo = 0, ring = null;
  // Touch leaves a ripple that lingers; a desktop click is a quick light pulse.
  const RING_F = CONFIG.pointer === 'cursor' ? 18 : 30;
  const paint = async () => {
    await page.evaluate(([x, y, o, r, isCursor]) => {
      window.__touch(x, y, 1, o);
      if (r) {
        const p = r.t, ei = Math.min(1, p / 0.22), eo = Math.max(0, (p - 0.22) / 0.78);
        const grow = 1 - Math.pow(1 - p, 3);
        const fade = (1 - Math.pow(1 - ei, 2)) * (1 - eo * eo);
        if (isCursor) window.__ring(r.x, r.y, 0.3 + 0.85 * grow, 0.8 * fade);
        else window.__ring(r.x, r.y, 0.7 + 1.3 * grow, 0.9 * fade);
      } else window.__ring(0, 0, 1, 0);
    }, [fx, fy, fo, ring, CONFIG.pointer === 'cursor']);
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
      // The real pointer follows the drawn one, so :hover, tooltips and
      // anything tracking pointermove behave as they would for a human.
      if (sendMove) await sendMove(fx, fy);
      await step();
    }
  };

  /* ---------- real input ----------
   * The drawn finger lives in prototype coordinates; Chrome's input pipeline
   * wants stage coordinates. In bare mode that's the identity, inside a device
   * frame it is not — get this wrong and every click lands in the wrong place
   * on framed captures while looking perfect on bare ones.
   */
  const toStage = (x, y) => (bare ? [x, y] : [SCREEN.x + x * S, SCREEN.y + y * S]);
  const touchInput = CONFIG.pointer === 'touch';
  let pressed = false;

  const send = async (kind, x, y) => {
    const [sx, sy] = toStage(x, y);
    if (touchInput) {
      // A touch screen has no hover: only report movement while a finger is
      // actually down, or the page sees a phantom drag across the whole clip.
      if (kind === 'move' && !pressed) return;
      const type = kind === 'down' ? 'touchStart' : kind === 'up' ? 'touchEnd' : 'touchMove';
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: sx, y: sy, id: 1 }],
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: kind === 'down' ? 'mousePressed' : kind === 'up' ? 'mouseReleased' : 'mouseMoved',
        x: sx, y: sy, button: 'left', clickCount: kind === 'move' ? 0 : 1,
        buttons: (kind === 'down' || (kind === 'move' && pressed)) ? 1 : 0,
      });
    }
  };

  /* What is actually under the pointer. element.click() always reached its
   * target even when covered; a real pointer hits whatever is on top, so an
   * overlay that used to be invisible to the recorder now silently eats the
   * click. Fail loudly instead. */
  const hits = async (sel, x, y) => page.evaluate(([s, cx, cy]) => {
    const top = document.elementFromPoint(cx, cy);
    const want = document.querySelector(s);
    if (!want || !top) return { ok: false, top: top ? (top.id || top.className || top.tagName) : 'nothing' };
    return { ok: want === top || want.contains(top) || top.contains(want), top: top.id || String(top.className) || top.tagName };
  }, [sel, ...toStage(x, y)]);

  sendMove = (x, y) => send('move', x, y);

  /** Swap the drawn cursor: 'arrow' | 'open' | 'grab'. No-op unless drawn. */
  const setCursor = async (kind) => {
    if (CONFIG.pointer !== 'cursor') return;
    await page.evaluate((k) => window.__cursor && window.__cursor(k), kind);
  };

  /** Move the pointer over a target without pressing — reveals :hover states.
   *  If the page says the thing under the pointer is grabbable, the drawn
   *  cursor becomes an open hand, the way a real one would. */
  const hover = async (target, frames = 24) => {
    const [x, y] = await resolve(target);
    await moveTo(x, y, frames, fo < 1);
    await send('move', fx, fy);
    if (CONFIG.pointer === 'cursor') {
      const grabbable = await page.evaluate(([cx, cy]) => {
        const el = document.elementFromPoint(cx, cy);
        // `pointer` deliberately excluded: a link or button is clicked, not grabbed.
        return !!el && ['grab', 'grabbing', 'move'].includes(getComputedStyle(el).cursor);
      }, toStage(fx, fy));
      await setCursor(grabbable ? 'open' : 'arrow');
    }
    await step();
  };

  /** Press and hold. Pair with release(), or use dragTo/longPress. */
  const press = async (target, frames = 24) => {
    const [x, y] = await resolve(target);
    if (Math.abs(x - fx) > 0.5 || Math.abs(y - fy) > 0.5) await moveTo(x, y, frames, fo < 1);
    await send('move', fx, fy);
    if (touchInput) {
      for (let i = 1; i <= 5; i++) {                                 // finger squash
        await page.evaluate(([a, b, s]) => window.__touch(a, b, s, 1), [fx, fy, 1 - 0.18 * (i / 5)]);
        await tick();
      }
    } else {
      // A cursor doesn't squash; it changes shape. Same five frames either way,
      // so frame counts don't depend on the pointer style.
      await setCursor('grab');
      for (let i = 0; i < 5; i++) await tick();
    }
    await send('down', fx, fy);
    pressed = true;
    ring = { x: fx, y: fy, t: 0 };
    taps.push({ sel: typeof target === 'string' ? target : `${Math.round(x)},${Math.round(y)}`, frame: n, x: Math.round(fx), y: Math.round(fy) });
    await step();
  };

  const release = async (after = 0) => {
    await send('up', fx, fy);
    pressed = false;
    await setCursor('arrow');
    await page.evaluate(([a, b]) => window.__touch(a, b, 1, 1), [fx, fy]);
    for (let i = 0; i < 5; i++) await step();
    if (after) await hold(after);
  };

  /** A target is a selector, or [x, y] in prototype coordinates. */
  const resolve = async (target) => {
    if (Array.isArray(target)) return target;
    if (!(await visible(target))) throw new Error(`target off-screen: ${target} — scroll or swipe to it first`);
    return centre(target);
  };

  const tap = async (sel, after = 30) => {
    if (typeof sel === 'string') {
      const h = await hits(sel, ...(await centre(sel)));
      if (!h.ok) throw new Error(`tap target is covered: ${sel} — "${h.top}" is on top at that point`);
    }
    await press(sel);
    await release(after);
  };

  /** Press, hold without moving, release — menus that open on a sustained press. */
  const longPress = async (target, frames = 42, after = 30) => {
    await press(target);
    await hold(frames);
    await release(after);
  };

  /**
   * Drag something: press the target, move, release. Real pointer events, so
   * bezier handles, sliders, scrubbers and canvas editors all work.
   * @param to  [x, y] absolute in prototype coords, {dx, dy} relative, or a selector
   */
  const dragTo = async (target, to, frames = 34, after = 20) => {
    frames = Math.round(frames * SLOW);
    await press(target);
    const x0 = fx, y0 = fy;
    let tx, ty;
    if (Array.isArray(to)) [tx, ty] = to;
    else if (to && (to.dx != null || to.dy != null)) { tx = x0 + (to.dx || 0); ty = y0 + (to.dy || 0); }
    else [tx, ty] = await resolve(to);
    for (let i = 1; i <= frames; i++) {
      const t = easeInOut(i / frames);
      fx = x0 + (tx - x0) * t;
      fy = y0 + (ty - y0) * t;
      await send('move', fx, fy);
      await step();
    }
    await release(after);
  };

  const swipe = async (sel, axis, delta, frames = 34) => {
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

  /* ---------- the walkthrough ----------
   * `drag` is the old scroll-a-scrollable verb, kept as an alias for configs
   * written before 0.2.0. New work wants `swipe` for scrolling and `dragTo`
   * for moving a thing. */
  const verbs = {
    tap, hover, press, release, dragTo, longPress, swipe, drag: swipe,
    hold, moveTo, fadeOut, extent, paint, step, tick, page, config: CONFIG,
  };
  try {
    await CONFIG.walkthrough(verbs);
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
