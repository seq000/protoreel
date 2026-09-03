// Tiny walkthrough used by test/run.mjs and CI. Frame count is asserted, so the
// numbers here are load-bearing: 10 + (24 + 5 + 5 + 40) + 6 + 10 = 100 frames.
export default {
  source: './fixture/index.html',
  view: { w: 320, h: 240 },
  frame: { png: null },
  deviceSelector: null,
  pointer: 'touch',
  fps: 60,
  scale: 1,
  slow: 1.0,
  outDir: './out',
  frameDir: './.frames',
  output: ['webm', 'mp4', 'poster'],
  async walkthrough({ tap, hold, fadeOut, paint }) {
    await paint();
    await hold(10);
    await tap('#go', 40);
    await fadeOut(6);
    await hold(10);
  },
};
