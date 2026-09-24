/* Tiny walkthrough used by test/run.mjs and CI.
 *
 * Frame count is asserted, so the numbers here are load-bearing:
 *   10  hold
 * + 75  tap    = press(moveTo 24 + squash 5 + 1) + release(5 + after 40)
 * + 79  dragTo = press(30) + 34 move frames + release(5 + after 10)
 * +  6  fadeOut
 * + 10  hold
 * = 180 frames
 *
 * `probe` is filled during the run and asserted afterwards — it's how the test
 * reads what the page actually believed, rather than guessing from pixels.
 */
export const probe = {};

export default {
  source: './fixture/index.html',
  view: { w: 320, h: 240 },
  frame: { png: null },
  deviceSelector: null,
  pointer: 'touch',
  fps: 60,
  scale: 1,
  slow: 1.0,
  clock: { start: '2026-01-01T09:41:00' },
  outDir: './out',
  frameDir: './.frames',
  output: ['webm', 'mp4', 'poster'],
  async walkthrough({ tap, dragTo, hold, fadeOut, paint, page }) {
    const read = () => page.evaluate(() => ({
      handleX: Number(document.getElementById('hx').textContent),
      raf: Number(document.getElementById('raf').textContent),
      perf: Number(document.getElementById('perf').textContent),
      date: document.getElementById('date').textContent,
      interval: Number(document.getElementById('iv').textContent),
      count: document.getElementById('count').textContent,
    }));

    await paint();
    await hold(10);
    await tap('#go', 40);

    probe.beforeDrag = await read();
    await dragTo('#handle', { dx: 150 }, 34, 10);
    probe.afterDrag = await read();

    await fadeOut(6);
    await hold(10);
    probe.end = await read();
  },
};
