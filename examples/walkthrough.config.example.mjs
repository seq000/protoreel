/* protoreel walkthrough config.
 *
 * Copy this next to your prototype, fill in the settings, write the walkthrough,
 * then:  npx protoreel walkthrough.config.mjs [name]
 *
 * Relative paths (source, frame.png, outDir) resolve against this file's folder.
 */
export default {
  // Source: a file path OR an http(s) URL.
  source: './index.html',

  // The prototype's own viewport, in CSS px.
  view: { w: 390, h: 844 },

  // Device frame. Leave `png: null` for a bare capture. See docs/device-frames.md
  // for how to export the frame and measure the screen slot.
  frame: {
    png: null,                                   // e.g. './frame/export@2x.png'
    stage: { w: 488, h: 830 },                   // frame size at 1×
    screen: { x: 76, y: 52, w: 336, h: 726, r: 45 },
    island: null,                                // e.g. { x: 193, y: 60.5, w: 98.5, h: 31 }
  },

  // The prototype's root element — scaled into the screen slot when a frame is used.
  // null = <body>.
  deviceSelector: null,

  // 'touch' | 'cursor' | 'none'
  pointer: 'touch',

  fps: 60,
  scale: 2,          // deviceScaleFactor; output is stage × scale
  slow: 1.0,         // global pacing multiplier
  outDir: './out',

  // Which files to produce. Any of 'webm', 'mp4', 'poster', 'gif'.
  output: ['webm', 'mp4', 'poster'],

  /* The walkthrough. Frames are 1/60 s. 30–50 after a tap reads comfortably;
     70–90 after something that changes the whole screen.

       tap(selector, holdFrames)                 move on an eased arc, press, click, ripple, hold
       drag(selector, 'x' | 'y', delta, frames)  finger-drag a scrollable element
       hold(frames)                              rest; animations and the ripple keep running
       moveTo(x, y, frames)                      reposition the pointer without clicking
       fadeOut(frames)                           fade the pointer out at the end
       extent(selector, axis)                    scrollable extent, for dragging exactly to the end
  */
  async walkthrough({ tap, drag, hold, fadeOut, extent, paint }) {
    await paint();
    await hold(45);
    // await tap('#openFilters', 50);
    // await drag('#list', 'y', 220, 34);
    // const max = await extent('#chips', 'x'); await drag('#chips', 'x', max, 44);
    await fadeOut(18);
    await hold(60);
  },
};
