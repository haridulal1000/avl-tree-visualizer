# AVL Tree Visualizer

An interactive, animated AVL tree visualizer built with WebGL, a Web Worker, and vanilla JS. Watch insertions, searches, updates, and deletions step through the tree in real time — complete with a think box that explains every comparison, color-coded nodes, and smooth rebalancing rotations.

You can also export the entire CRUD sequence as an MP4 video, in whatever resolution and framerate you want.

## What it does

- **Build** an AVL tree from a comma-separated array, or generate a random one.
- **Insert, Search, Update, Delete** — each operation animates the full decision path with a "think box" describing what's happening.
- **Autoplay** runs Build → Insert → Search → Update → Delete in sequence, using whatever inputs you've filled in.
- **Export** renders the whole sequence offline (not realtime) into an MP4 via WebCodecs. 480p, 720p, 1080p, 1440p — pick your framerate too.
- **Customize** everything: animation speed, camera smoothing, node size, branch spread, fonts, aspect ratio (16:9, 9:16, 1:1, 4:3, 21:9), and background theme (solid or grid).
- **Pause** for a configurable number of seconds between each CRUD operation — this applies to both the live autoplay and the exported video.

## Quick start

1. Open `index.html` in a modern browser (Chrome, Edge, or Firefox with WebGL2 and WebCodecs support).
2. The tree builds automatically from a random 18-number dataset.
3. Try hitting **▶ Autoplay all** — it runs the whole CRUD flow with the defaults already filled in.
4. Click **⬇ Export video** for an MP4 of the same animation.

No build step, no npm install. Just serve the folder (any static server works — `python -m http.server`, Live Server, etc.) and open it.

## File structure
index.html – layout and panels
css/style.css – all styling
js/layout.js – in-order tree layout algorithm
js/renderer.js – WebGL2 node/edge renderer
js/overlay.js – 2D overlay: labels, array strip, think box
js/animator.js – Web Worker: AVL tree logic + frame generator
js/ui.js – DOM wiring, tooltips, slider bindings
js/main.js – orchestrator: playback, autoplay, export


The worker builds the entire animation as a list of frames ahead of time, then the main thread just plays them back. This keeps playback smooth no matter how big the tree gets.

## Notes

- **Export uses `mp4-muxer`** (loaded from a CDN) for MP4 output via WebCodecs. If that fails to load, it falls back to WebM via MediaRecorder.
- **Fonts and themes are preserved in export** — the exported video includes the exact same background, think boxes, array strip, and colors you see on screen.
- **The exported video plays at the same speed as the on-screen animation** (adjusted by the Master and Logic speed sliders), plus any pause configured between operations.
- **Estimated length** is shown in the Export card — it updates live as you tweak inputs, pause, or speed.

## Known quirks

- WebCodecs is required for the fast MP4 path. Safari 16+ works; older browsers fall back to WebM.
- On very large trees (60+ nodes), expect deeper zoomed-out views. The camera auto-fits, but node labels can get small.
- If you switch themes mid-export, the exported video will use whichever theme was selected when you clicked Export.

## Credits

Built as a from-scratch AVL visualizer with WebGL2, Web Workers, and WebCodecs. The think box, tooltips, and typography controls were added iteratively based on real usage feedback.

## How to run it

You just need a static file server — no build step, no install.

**Option 1 — Python (already installed on most systems):**

```bash
# from inside the project folder
python -m http.server 8000

Then open http://localhost:8000 in your browser.

Option 2 — Node (if you have it):

npx serve .

It'll print a URL like http://localhost:3000 — open that.

Option 3 — VS Code Live Server:

Right-click index.html → Open with Live Server.

Don't just double-click index.html. The Web Worker (js/animator.js) and the CDN scripts need to load over http:// or https://, not file://, or the app won't run.


Paste that at the end of the README, right before (or after) the **Credits** section — either spot reads fine.