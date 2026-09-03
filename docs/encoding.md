# Encoding

Frames are numbered PNGs in `.frames/`; ffmpeg reads them as an image sequence at the
capture frame rate. There is no audio anywhere in this pipeline.

`protoreel` runs the commands below for you — `output: ['webm', 'mp4', 'poster']` in
the config picks which (add `'gif'` for a GIF). This page is the reasoning behind the
flags, and the recipe if you want to re-encode `.frames/` by hand.

## Web (the default pair)

Two files, because no single codec is both small and universally supported:

```bash
# VP9 — smaller, two-pass for a stable bitrate at a fixed quality
ffmpeg -y -framerate 60 -i .frames/%05d.png -c:v libvpx-vp9 -b:v 0 -crf 26 \
  -pass 1 -an -pix_fmt yuv420p -f null /dev/null
ffmpeg -y -framerate 60 -i .frames/%05d.png -c:v libvpx-vp9 -b:v 0 -crf 26 \
  -pass 2 -an -pix_fmt yuv420p -row-mt 1 out.webm

# H.264 — the fallback every browser plays
ffmpeg -y -framerate 60 -i .frames/%05d.png -c:v libx264 -preset slow -crf 20 \
  -pix_fmt yuv420p -movflags +faststart -an out.mp4
```

- `-b:v 0` is required for VP9 CRF mode; without it CRF is ignored.
- `-pix_fmt yuv420p` is not optional — 4:4:4 output fails to play in Safari and on iOS.
- `+faststart` puts the MP4 index first so it streams instead of buffering whole.
- Expect roughly 60–70 KB/s of clip at these settings for UI footage.

**CRF guidance for UI:** 26 (VP9) / 20 (x264) keeps hairlines and 12px type clean.
Going to CRF 32 halves the file and crushes soft gradients — visible on dark UI and on
photographic content, invisible on flat light UI. Test before trusting it.

## Poster

An unloaded `<video>` with `preload="none"` renders as an empty box the exact size of
the video — no error, no broken-image icon. Always produce a poster:

```bash
ffmpeg -y -i .frames/00000.png -q:v 4 out-poster.jpg
```

Pick a later frame if frame 0 is a blank or loading state.

## GIF

Only when the destination cannot take a video (some email clients, some wikis). Two
passes with a palette, or the result is 256-colour mush:

```bash
ffmpeg -y -i .frames/%05d.png -vf "fps=24,scale=480:-1:flags=lanczos,palettegen=stats_mode=diff" pal.png
ffmpeg -y -i .frames/%05d.png -i pal.png -lavfi "fps=24,scale=480:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3" out.gif
```

A GIF of the same clip is typically 5–10× the MP4. Say so before producing one.

## Verify the artefact

Correct-looking commands are not evidence. Probe the output and report real numbers:

```bash
ffprobe -v error -select_streams v -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt \
  -show_entries format=duration,size -of default=nw=1 out.webm
```

Check the frame rate is what you captured, the duration matches
`frames ÷ fps`, and the pixel format is `yuv420p`.

## Matching an existing project

If the destination already has videos, match them rather than imposing these defaults:

```bash
ffprobe -v error -select_streams v -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt -of default=nw=1 existing.webm
```

A new clip that differs in frame rate or codec from its neighbours will look wrong
next to them even when it is technically better.
