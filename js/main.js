/* ============ js/main.js ============ */
(function () {
  'use strict';

  const stage    = document.getElementById('stage');
  const frame    = document.getElementById('frame');
  const canvasGL = document.getElementById('gl');
  const canvasFX = document.getElementById('fx');

  const renderer = new Renderer(canvasGL);
  const overlay  = new Overlay(canvasFX);
  const worker   = new Worker('js/animator.js');

  /* ------------------------------------------------------------------ */
  /*  Background themes                                                  */
  /* ------------------------------------------------------------------ */

  const THEMES = {
    midnight: { bg: '#05070c', grid: null,                      cell: 48 },
    slate:    { bg: '#1a2028', grid: null,                      cell: 48 },
    navy:     { bg: '#0b1a2e', grid: null,                      cell: 48 },
    forest:   { bg: '#0f1a12', grid: null,                      cell: 48 },
    plum:     { bg: '#1a0f1e', grid: null,                      cell: 48 },
    gridDark: { bg: '#05070c', grid: 'rgba(120,170,240,0.09)',  cell: 48 },
    gridNavy: { bg: '#0b1a2e', grid: 'rgba(90,180,240,0.11)',   cell: 48 },
    gridWarm: { bg: '#14100a', grid: 'rgba(240,180,110,0.10)',  cell: 48 }
  };

  const App = {
    frames: [],
    frameIndex: 0,
    clock: 0,
    playing: true,
    requestId: 0,
    waiting: false,
    pendingRebuild: false,
    exporting: false,
    autoplay: false,
    _autoplayResolve: null,
    _pendingSequence: null,
    _liveFrameW: 1280,

    theme: THEMES.midnight,
    themeName: 'midnight',

    camera:       { cx: 0, cy: 0, scale: 120 },
    targetCamera: { cx: 0, cy: 0, scale: 120 },

    nodes: new Map(),
    tree: [],
    marks: {},
    bubble: { title: '', detail: '' },

    aspect: { w: 16, h: 9 },

    opts: {
      master: 1, logic: 1, struct: 1, cameraSp: 1,
      spread: 1.35, nodeR: 0.38, zoom: 1,
      showValues: true, showHeights: false, showBF: false, showFlow: true,
      fontFamily: 'system', labelScale: 1, bubbleScale: 1,
      pauseSec: 1
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Theme application                                                  */
  /* ------------------------------------------------------------------ */

  function applyThemeToFrame(theme) {
    frame.style.backgroundColor = theme.bg;
    if (theme.grid) {
      const cell = theme.cell || 48;
      frame.style.backgroundImage =
        `linear-gradient(${theme.grid} 1px, transparent 1px), ` +
        `linear-gradient(90deg, ${theme.grid} 1px, transparent 1px)`;
      frame.style.backgroundSize = `${cell}px ${cell}px`;
    } else {
      frame.style.backgroundImage = 'none';
    }
  }

  /**
   * Paint the theme onto an arbitrary 2D context so exports match the live
   * view. The grid cell is scaled so the exported frame has the same number
   * of columns as the live frame, regardless of export resolution.
   */
  function drawThemeBackground(ctx, W, H, theme, liveFrameW) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    if (!theme.grid) return;

    const refW = Math.max(200, liveFrameW || 1280);
    const cell = (theme.cell || 48) * (W / refW);
    const lineW = Math.max(1, cell / 48);

    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = lineW;
    ctx.beginPath();

    for (let x = 0; x <= W + 0.5; x += cell) {
      const px = Math.floor(x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
    }
    for (let y = 0; y <= H + 0.5; y += cell) {
      const py = Math.floor(y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(W, py);
    }
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /*  Worker plumbing                                                    */
  /* ------------------------------------------------------------------ */

  function sendToWorker(payload) {
    if (App.waiting) return;
    App.waiting = true;
    if (payload.type === 'build') App.pendingRebuild = true;
    payload.requestId = ++App.requestId;
    worker.postMessage(payload);
  }

  function fetchFullSequence(ops) {
    return new Promise((resolve, reject) => {
      const pick = (t) => ops.find((o) => o.type === t) || {};
      App._pendingSequence = { resolve, reject };
      App.waiting = true;
      worker.postMessage({
        type: 'full-sequence',
        requestId: ++App.requestId,
        build:  pick('build').values  || [],
        insert: pick('insert').values || [],
        search: pick('search').values || [],
        update: pick('update').pairs  || [],
        delete: pick('delete').values || [],
        pauseMs: Math.max(0, App.opts.pauseSec * 1000)
      });
    });
  }

  worker.onmessage = function (e) {
    const msg = e.data || {};

    if (App._pendingSequence) {
      const p = App._pendingSequence;
      App._pendingSequence = null;
      App.waiting = false;
      if (msg.type === 'error') {
        p.reject(new Error(msg.message || 'Worker error'));
      } else if (msg.type === 'frames') {
        p.resolve(msg.frames || []);
      } else {
        p.reject(new Error('Unexpected worker response'));
      }
      return;
    }

    if (msg.type === 'error') {
      App.waiting = false;
      App.pendingRebuild = false;
      if (App._autoplayResolve) { const r = App._autoplayResolve; App._autoplayResolve = null; r(); }
      console.error('[worker]', msg.message);
      UI.setStatus('Worker error — see console');
      return;
    }
    if (msg.type !== 'frames') return;

    App.waiting = false;
    if (App.pendingRebuild) {
      App.nodes.clear();
      App.pendingRebuild = false;
    }

    App.frames = msg.frames || [];
    App.frameIndex = 0;
    App.clock = 0;
    UI.resetLog();
    UI.updatePlayback(0, App.frames.length);

    if (App.frames.length === 0) {
      App.tree = [];
      App.marks = {};
      App.bubble = { title: '', detail: '' };
      App.nodes.clear();
      renderer.clear();
      overlay.clear();
      return;
    }

    syncNodes(App.frames[0]);
    updateCameraTarget();
    setStatusFromFrame(0);

    App.playing = true;
    UI.setPlaying(true);

    if (App._autoplayResolve) {
      const r = App._autoplayResolve;
      App._autoplayResolve = null;
      waitForPlaybackComplete().then(r);
    }
  };

  worker.onerror = function (err) {
    App.waiting = false;
    App.pendingRebuild = false;
    if (App._pendingSequence) {
      const p = App._pendingSequence; App._pendingSequence = null;
      p.reject(new Error(err.message || 'Worker fatal'));
    }
    if (App._autoplayResolve) { const r = App._autoplayResolve; App._autoplayResolve = null; r(); }
    console.error('[worker fatal]', err.message || err);
    UI.setStatus('Worker failed to load');
  };

  function waitForPlaybackComplete() {
    return new Promise((resolve) => {
      const check = () => {
        if (App.frameIndex >= App.frames.length - 1) { resolve(); return; }
        requestAnimationFrame(check);
      };
      setTimeout(check, 40);
    });
  }

  function sendOpAndWait(op) {
    return new Promise((resolve) => {
      App._autoplayResolve = resolve;
      sendToWorker(op);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Frame → visual state                                               */
  /* ------------------------------------------------------------------ */

  function findParentId(tree, id) {
    for (let i = 0; i < tree.length; i++) {
      const n = tree[i];
      if (n.left === id || n.right === id) return n.id;
    }
    return null;
  }

  function syncNodes(f) {
    if (!window.Layout) {
      console.error('Layout module is missing. Ensure js/layout.js is loaded before main.js.');
      return;
    }

    const layout = window.Layout.computeLayout(f.tree, { spread: App.opts.spread });
    const byId = new Map();
    for (let i = 0; i < f.tree.length; i++) byId.set(f.tree[i].id, f.tree[i]);

    if (App.nodes.size > 0) {
      let overlap = false;
      for (const id of App.nodes.keys()) {
        if (byId.has(id)) { overlap = true; break; }
      }
      if (!overlap) App.nodes.clear();
    }

    const seen = new Set();

    for (const [id, p] of layout.pos) {
      seen.add(id);
      const data = byId.get(id);
      let st = App.nodes.get(id);

      if (!st) {
        st = {
          x: p.x, y: p.y, tx: p.x, ty: p.y,
          s: 0, ts: 1, a: 0, ta: 1,
          key: data.key, h: data.h, bf: data.bf,
          dying: false
        };
        const pid = findParentId(f.tree, id);
        if (pid != null && App.nodes.has(pid)) {
          const pp = App.nodes.get(pid);
          st.x = pp.x;
          st.y = pp.y;
        }
        App.nodes.set(id, st);
      } else {
        st.dying = false;
        st.ta = 1;
        st.ts = 1;
        st.key = data.key;
        st.h = data.h;
        st.bf = data.bf;
      }
      st.tx = p.x;
      st.ty = p.y;
    }

    for (const [id, st] of App.nodes) {
      if (!seen.has(id)) {
        st.dying = true;
        st.ta = 0;
        st.ts = 0.35;
      }
    }

    App.tree = f.tree;
    App.marks = f.marks || {};
    App.bubble = f.bubble || { title: '', detail: '' };
  }

  function updateCameraTarget() {
    const W = frame.clientWidth;
    const H = frame.clientHeight;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let any = false;

    for (const st of App.nodes.values()) {
      if (st.dying) continue;
      any = true;
      if (st.tx < minX) minX = st.tx;
      if (st.tx > maxX) maxX = st.tx;
      if (st.ty < minY) minY = st.ty;
      if (st.ty > maxY) maxY = st.ty;
    }

    if (!any || W < 2 || H < 2) {
      App.targetCamera = { cx: 0, cy: 0, scale: 120 };
      return;
    }

    const pad = App.opts.nodeR * 2.5;
    const reservedTop    = Math.min(90, H * 0.16);
    const reservedBottom = Math.min(110, H * 0.20);
    const reserved = reservedTop + reservedBottom;

    const treeW = Math.max(maxX - minX + pad * 2, 2);
    const treeH = Math.max(maxY - minY + pad * 2, 2);

    const scaleW = W / treeW;
    const scaleH = (H - reserved) / treeH;
    const scale = Math.min(scaleW, scaleH) * 0.94 * App.opts.zoom;

    const cx = (minX + maxX) / 2;
    const centerScreenY = reservedTop + (H - reserved) / 2;
    const cy = (minY + maxY) / 2 - (centerScreenY - H / 2) / scale;

    App.targetCamera = { cx, cy, scale };
  }

  function setStatusFromFrame(index) {
    const f = App.frames[index];
    if (!f) return;
    UI.setStatus(f.log || f.bubble.title || '');
    UI.pushLog(f.log || f.bubble.title, index);
  }

  function jumpTo(index) {
    if (!App.frames.length) return;
    index = Math.max(0, Math.min(App.frames.length - 1, index));
    App.frameIndex = index;
    App.clock = 0;
    syncNodes(App.frames[index]);
    updateCameraTarget();
    UI.updatePlayback(index, App.frames.length);
    setStatusFromFrame(index);
  }

  /* ------------------------------------------------------------------ */
  /*  Playback                                                           */
  /* ------------------------------------------------------------------ */

  function advancePlayback(dt, force) {
    if (App.frames.length === 0) return;
    if (!force && !App.playing) return;

    const speed = App.opts.master * App.opts.logic;
    App.clock += dt * 1000 * speed;

    let guard = 0;
    while (guard++ < 16) {
      const f = App.frames[App.frameIndex];
      if (App.clock < f.hold) break;
      if (App.frameIndex >= App.frames.length - 1) {
        App.clock = f.hold;
        break;
      }
      App.clock -= f.hold;
      App.frameIndex++;
      syncNodes(App.frames[App.frameIndex]);
      updateCameraTarget();
      if (!App.exporting) {
        UI.updatePlayback(App.frameIndex, App.frames.length);
        setStatusFromFrame(App.frameIndex);
      }
    }
  }

  function smoothNodes(dt) {
    const k = 1 - Math.exp(-dt * 9.0 * App.opts.struct);
    for (const [id, st] of App.nodes) {
      st.x += (st.tx - st.x) * k;
      st.y += (st.ty - st.y) * k;
      st.s += (st.ts - st.s) * k;
      st.a += (st.ta - st.a) * k;
      if (st.dying && st.a < 0.012) App.nodes.delete(id);
    }
  }

  function smoothCamera(dt) {
    const k = 1 - Math.exp(-dt * 6.0 * App.opts.cameraSp);
    const c = App.camera;
    const t = App.targetCamera;
    c.cx += (t.cx - c.cx) * k;
    c.cy += (t.cy - c.cy) * k;
    c.scale += (t.scale - c.scale) * k;
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                          */
  /* ------------------------------------------------------------------ */

  function buildProjection(W, H, cam) {
    const sx = (2 * cam.scale) / W;
    const sy = (2 * cam.scale) / H;
    return new Float32Array([
      sx, 0, 0, 0,
      0, -sy, 0, 0,
      0, 0, 1, 0,
      -cam.cx * sx, cam.cy * sy, 0, 1
    ]);
  }

  function nodeColors(id) {
    const m = App.marks;
    let fill = [0.13, 0.17, 0.25];
    let ring = [0.42, 0.60, 0.88];
    let glow = 0.0;

    if (m.path && m.path.indexOf(id) !== -1) {
      fill = [0.11, 0.19, 0.33]; ring = [0.36, 0.64, 0.98]; glow = 0.35;
    }
    if (m.hot && m.hot.indexOf(id) !== -1) {
      fill = [0.34, 0.12, 0.20]; ring = [1.00, 0.42, 0.55]; glow = 0.85;
    }
    if (m.found && m.found.indexOf(id) !== -1) {
      fill = [0.08, 0.28, 0.20]; ring = [0.35, 1.00, 0.65]; glow = 0.90;
    }
    if (m.current === id) {
      fill = [0.10, 0.28, 0.38]; ring = [0.45, 0.92, 1.00]; glow = 1.00;
    }
    return { fill, ring, glow };
  }

  function collectBuffers() {
    const nodeData = [];
    const edgeData = [];
    const baseR = App.opts.nodeR;
    const flow = App.opts.showFlow;
    const marks = App.marks;
    const pathSet = flow && marks.path ? new Set(marks.path) : null;

    for (let i = 0; i < App.tree.length; i++) {
      const n = App.tree[i];
      const a = App.nodes.get(n.id);
      if (!a || a.a < 0.05) continue;

      const sides = [n.left, n.right];
      for (let s = 0; s < 2; s++) {
        const cid = sides[s];
        if (cid == null) continue;
        const b = App.nodes.get(cid);
        if (!b || b.a < 0.05) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const r = baseR * 0.94;
        const ux = dx / len;
        const uy = dy / len;

        const ax = a.x + ux * r;
        const ay = a.y + uy * r;
        const bx = b.x - ux * r;
        const by = b.y - uy * r;

        const onPath = pathSet && pathSet.has(n.id) && pathSet.has(cid);
        const cr = onPath ? 0.55 : 0.34;
        const cg = onPath ? 0.80 : 0.54;
        const cb = onPath ? 1.00 : 0.86;
        const ca = onPath ? 0.85 : 0.42;
        const w = baseR * (onPath ? 0.13 : 0.085);

        edgeData.push(ax, ay, bx, by, w, cr, cg, cb, ca);
      }
    }

    for (const [id, st] of App.nodes) {
      if (st.a < 0.012) continue;
      const c = nodeColors(id);
      const radius = baseR * st.s;
      nodeData.push(
        st.x, st.y, radius,
        c.fill[0], c.fill[1], c.fill[2],
        c.ring[0], c.ring[1], c.ring[2],
        c.glow * st.a
      );
    }

    return {
      nodeData: new Float32Array(nodeData),
      edgeData: new Float32Array(edgeData)
    };
  }

  function currentFrame() {
    return App.frames[App.frameIndex] || null;
  }

  function renderScene() {
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    if (W < 2 || H < 2) return;

    const proj = buildProjection(W, H, App.camera);
    const buffers = collectBuffers();

    renderer.clear();
    overlay.clear();
    renderer.draw(proj, buffers.nodeData, buffers.edgeData);

    const f = currentFrame();
    overlay.draw({
      camera: App.camera,
      nodes: App.nodes,
      marks: App.marks,
      bubble: App.bubble,
      opts: App.opts,
      array: f ? f.array : null,
      arrayIndex: f ? f.arrayIndex : -1
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Frame sizing / aspect ratio                                        */
  /* ------------------------------------------------------------------ */

  function applyFrameSize(snap) {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (sw < 2 || sh < 2) return;

    const a = App.aspect.w / App.aspect.h;
    let fw = sw;
    let fh = fw / a;
    if (fh > sh) { fh = sh; fw = fh * a; }
    fw = Math.max(1, Math.round(fw));
    fh = Math.max(1, Math.round(fh));

    frame.style.width = fw + 'px';
    frame.style.height = fh + 'px';

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(fw, fh, dpr);
    overlay.resize(fw, fh, dpr);

    updateCameraTarget();
    if (snap) {
      App.camera.cx = App.targetCamera.cx;
      App.camera.cy = App.targetCamera.cy;
      App.camera.scale = App.targetCamera.scale;
    }
    renderer.clear();
    overlay.clear();
  }

  function handleResize() { applyFrameSize(true); }
  window.addEventListener('resize', handleResize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(handleResize).observe(stage);
  }

  /* ------------------------------------------------------------------ */
  /*  Main loop                                                          */
  /* ------------------------------------------------------------------ */

  let lastTime = performance.now();
  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (App.exporting) {
      requestAnimationFrame(tick);
      return;
    }

    advancePlayback(dt, false);
    smoothNodes(dt);
    smoothCamera(dt);

    renderScene();

    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ */
  /*  Autoplay                                                           */
  /* ------------------------------------------------------------------ */

  function parseNumbers(str) {
    return String(str || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map(Number).filter(Number.isFinite);
  }

  function parsePairs(str) {
    return String(str || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => {
        const parts = s.split(':').map((p) => p.trim());
        if (parts.length !== 2) return null;
        const a = Number(parts[0]), b = Number(parts[1]);
        return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
      })
      .filter(Boolean);
  }

  function collectAutoplayOps() {
    const $ = (id) => document.getElementById(id);
    const buildVals   = parseNumbers($('dataInput').value);
    const insertVals  = parseNumbers($('insertInput').value);
    const searchVals  = parseNumbers($('searchInput').value);
    const updatePairs = parsePairs($('updateInput').value);
    const deleteVals  = parseNumbers($('deleteInput').value);

    const ops = [];
    if (buildVals.length)   ops.push({ type: 'build',  values: buildVals });
    if (insertVals.length)  ops.push({ type: 'insert', values: insertVals });
    if (searchVals.length)  ops.push({ type: 'search', values: searchVals });
    if (updatePairs.length) ops.push({ type: 'update', pairs:  updatePairs });
    if (deleteVals.length)  ops.push({ type: 'delete', values: deleteVals });
    return ops;
  }

  function disableOpButtons(disable) {
    const ids = ['btnBuild', 'btnInsert', 'btnSearch', 'btnUpdate', 'btnDelete',
                 'btnRandom', 'btnAutoplay', 'btnExport'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.disabled = disable;
    }
  }

  async function autoplayAll() {
    if (App.autoplay) return;
    const ops = collectAutoplayOps();
    if (!ops.length) {
      UI.setStatus('Nothing to autoplay — fill some inputs first');
      return;
    }

    App.autoplay = true;
    disableOpButtons(true);
    UI.setStatus('Autoplay starting…');

    const pauseMs = Math.max(0, App.opts.pauseSec * 1000);

    try {
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        UI.setStatus(`Autoplay: ${op.type} (${i + 1}/${ops.length})`);
        await sendOpAndWait(op);
        if (pauseMs > 0) {
          await new Promise((r) => setTimeout(r, pauseMs));
        }
      }
      UI.setStatus('Autoplay complete');
    } catch (e) {
      console.error('Autoplay failed:', e);
      UI.setStatus('Autoplay failed — see console');
    } finally {
      App.autoplay = false;
      disableOpButtons(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Defaults seeding                                                   */
  /* ------------------------------------------------------------------ */

  function seedDefaultsFromDataset() {
    const raw = document.getElementById('dataInput').value;
    const vals = raw.split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
    if (!vals.length) return;

    const sorted = vals.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const maxV = sorted[n - 1];
    const minV = sorted[0];

    const inserts = [];
    for (let i = 0; i < 6; i++) inserts.push(maxV + 10 + i * 10);
    document.getElementById('insertInput').value = inserts.join(', ');

    const searchVals = [];
    const existingCount = Math.min(3, n);
    for (let i = 0; i < existingCount; i++) {
      searchVals.push(sorted[Math.floor((i + 1) * n / (existingCount + 1))]);
    }
    searchVals.push(maxV + 999);
    searchVals.push(minV - 100);
    document.getElementById('searchInput').value = searchVals.join(', ');

    const pairs = [];
    const updateFrom = new Set();
    const updateCount = Math.min(5, n);
    for (let i = 0; i < updateCount; i++) {
      const idx = Math.floor(i * n / updateCount);
      const from = sorted[idx];
      if (updateFrom.has(from)) continue;
      updateFrom.add(from);
      pairs.push(`${from}:${maxV + 1000 + i * 100}`);
    }
    document.getElementById('updateInput').value = pairs.join(', ');

    const deleteVals = [];
    for (let i = 0; i < n && deleteVals.length < 6; i++) {
      if (!updateFrom.has(sorted[i])) deleteVals.push(sorted[i]);
    }
    for (let i = 0; i < inserts.length && deleteVals.length < 6; i++) {
      deleteVals.push(inserts[i]);
    }
    document.getElementById('deleteInput').value = deleteVals.join(', ');
  }

  /* ------------------------------------------------------------------ */
  /*  Duration estimation                                                */
  /* ------------------------------------------------------------------ */

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function estimateDurationMs() {
    const ops = collectAutoplayOps();
    if (!ops.length) return 0;

    const treeSize = Math.max(3, parseNumbers(document.getElementById('dataInput').value).length || 18);
    const depth = Math.ceil(Math.log2(treeSize + 1));
    const avgHoldMs = 580;

    let frameCount = 0;
    for (const op of ops) {
      if (op.type === 'build') {
        frameCount += 2 + op.values.length * (depth + 2);
      } else if (op.type === 'insert') {
        frameCount += op.values.length * (depth + 3);
      } else if (op.type === 'search') {
        frameCount += op.values.length * (depth + 1);
      } else if (op.type === 'update') {
        frameCount += op.pairs.length * (2 * depth + 4);
      } else if (op.type === 'delete') {
        frameCount += op.values.length * (depth + 4);
      }
    }

    const animMs = frameCount * avgHoldMs;
    const pauseMs = ops.length * App.opts.pauseSec * 1000;
    const speed = Math.max(0.01, App.opts.master * App.opts.logic);

    return (animMs + pauseMs) / speed;
  }

  function updateLengthInfo() {
    const panelEl = document.getElementById('lengthInfo');
    const modalEl = document.getElementById('exportLength');
    const ms = estimateDurationMs();
    const text = ms > 0 ? `≈ ${formatDuration(ms)}` : '—';
    if (panelEl) panelEl.textContent = text;
    if (modalEl) modalEl.textContent = text;
  }

  /* ------------------------------------------------------------------ */
  /*  Export                                                             */
  /* ------------------------------------------------------------------ */

  function openExportModal() {
    if (App.exporting || App.autoplay) return;
    updateLengthInfo();
    document.getElementById('exportModal').classList.remove('hidden');
    document.getElementById('exportProgress').classList.add('hidden');
  }

  function closeExportModal() {
    document.getElementById('exportModal').classList.add('hidden');
  }

  function makeProgress() {
    const wrap = document.getElementById('exportProgress');
    const bar  = wrap.querySelector('.progress-bar');
    const fill = wrap.querySelector('.progress-fill');
    const text = wrap.querySelector('.progress-text');
    wrap.classList.remove('hidden');

    return {
      set: (frac) => {
        bar.classList.remove('indeterminate');
        const p = Math.max(0, Math.min(100, frac * 100));
        fill.style.width = p.toFixed(1) + '%';
        text.textContent = `Rendering… ${Math.round(p)}%`;
      },
      stage: (msg) => {
        bar.classList.add('indeterminate');
        text.textContent = msg;
      },
      done: (msg) => {
        bar.classList.remove('indeterminate');
        fill.style.width = '100%';
        text.textContent = msg || 'Complete';
      },
      remove: () => wrap.classList.add('hidden')
    };
  }

  async function exportVideo(fps, quality) {
    if (App.exporting) return;

    const ops = collectAutoplayOps();
    if (!ops.length) {
      alert('Nothing to export. Fill at least one operation input.');
      return;
    }

    const aspect = App.aspect.w / App.aspect.h;
    let outH = Number(quality);
    let outW = Math.round((outH * aspect) / 2) * 2;
    outH = Math.round(outH / 2) * 2;

    App.exporting = true;
    UI.setStatus('Preparing export…');
    disableOpButtons(true);

    let fullFrames;
    try {
      fullFrames = await fetchFullSequence(ops);
    } catch (err) {
      console.error('Export sequence failed:', err);
      alert('Export failed: ' + (err.message || err));
      App.exporting = false;
      disableOpButtons(false);
      return;
    }

    if (!fullFrames || !fullFrames.length) {
      alert('Export failed — worker returned no frames.');
      App.exporting = false;
      disableOpButtons(false);
      return;
    }

    const saved = {
      frames: App.frames,
      frameIndex: App.frameIndex,
      clock: App.clock,
      playing: App.playing,
      camera: { ...App.camera },
      targetCamera: { ...App.targetCamera },
      nodes: new Map(),
      tree: App.tree,
      marks: App.marks,
      bubble: App.bubble,
      frameW: frame.style.width,
      frameH: frame.style.height
    };
    for (const [k, v] of App.nodes) saved.nodes.set(k, { ...v });

    // Capture live frame width BEFORE we resize for export, so the theme
    // grid keeps the same visual density between live view and export.
    App._liveFrameW = frame.clientWidth || 1280;

    frame.style.width = outW + 'px';
    frame.style.height = outH + 'px';
    renderer.resize(outW, outH, 1);
    overlay.resize(outW, outH, 1);

    App.frames = fullFrames;
    App.frameIndex = 0;
    App.clock = 0;
    App.playing = false;
    App.nodes.clear();
    syncNodes(App.frames[0]);
    updateCameraTarget();
    App.camera.cx = App.targetCamera.cx;
    App.camera.cy = App.targetCamera.cy;
    App.camera.scale = App.targetCamera.scale;

    const dt = 1 / fps;
    const totalMs = App.frames.reduce((s, f) => s + f.hold, 0);
    const speed = Math.max(0.01, App.opts.master * App.opts.logic);
    const totalDurationS = (totalMs / 1000) / speed;
    const totalFrames = Math.max(1, Math.ceil(totalDurationS * fps));

    const progress = makeProgress();

    const comp = document.createElement('canvas');
    comp.width = outW;
    comp.height = outH;
    const compCtx = comp.getContext('2d', { alpha: false });

    const canWebCodecs = typeof VideoEncoder !== 'undefined' && window.Mp4Muxer;

    let result = null;
    let success = false;

    try {
      if (canWebCodecs) {
        result = await webCodecsExport({
          totalFrames, dt, outW, outH, fps, comp, compCtx, progress
        });
      } else {
        result = await mediaRecorderExport({
          totalFrames, dt, outW, outH, fps, comp, compCtx, progress
        });
      }
      success = true;
    } catch (e) {
      console.error('Export failed:', e);
      alert('Export failed: ' + (e.message || e));
    }

    frame.style.width = saved.frameW;
    frame.style.height = saved.frameH;
    const dprRestore = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(frame.clientWidth, frame.clientHeight, dprRestore);
    overlay.resize(frame.clientWidth, frame.clientHeight, dprRestore);

    App.exporting = false;
    disableOpButtons(false);

    if (success) {
      App.frameIndex = 0;
      App.clock = 0;
      App.playing = true;
      App.nodes.clear();
      syncNodes(App.frames[0]);
      updateCameraTarget();
      App.camera.cx = App.targetCamera.cx;
      App.camera.cy = App.targetCamera.cy;
      App.camera.scale = App.targetCamera.scale;
      UI.updatePlayback(0, App.frames.length);
      UI.resetLog();
      setStatusFromFrame(0);
      UI.setPlaying(true);
    } else {
      App.frames = saved.frames;
      App.frameIndex = saved.frameIndex;
      App.clock = saved.clock;
      App.playing = saved.playing;
      App.camera = saved.camera;
      App.targetCamera = saved.targetCamera;
      App.nodes = saved.nodes;
      App.tree = saved.tree;
      App.marks = saved.marks;
      App.bubble = saved.bubble;
      syncNodes(App.frames[App.frameIndex] || { tree: [], marks: {}, bubble: { title: '', detail: '' } });
      updateCameraTarget();
      UI.setPlaying(App.playing);
      renderScene();
    }

    progress.done();
    setTimeout(() => progress.remove(), 400);
    updateLengthInfo();

    if (result) {
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `avl-tree-${Date.now()}.${result.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  async function testEncodeConfig(cfg, outW, outH) {
    let err = null;
    const test = new VideoEncoder({
      output: () => {},
      error: (e) => { err = e; }
    });
    try {
      test.configure(cfg);
      const c = document.createElement('canvas');
      c.width = outW; c.height = outH;
      const cx = c.getContext('2d', { alpha: false });
      cx.fillStyle = '#000';
      cx.fillRect(0, 0, outW, outH);
      const f = new VideoFrame(c, { timestamp: 0, alpha: 'discard' });
      test.encode(f);
      f.close();
      await test.flush();
      test.close();
      return !err;
    } catch (e) {
      try { test.close(); } catch (e2) {}
      return false;
    }
  }

  /**
   * Composite a rendered frame: theme background first, then the WebGL
   * canvas (transparent where nothing is drawn) and the 2D overlay.
   */
  function composeFrame(compCtx, outW, outH) {
    drawThemeBackground(compCtx, outW, outH, App.theme, App._liveFrameW);
    compCtx.drawImage(canvasGL, 0, 0, outW, outH);
    compCtx.drawImage(canvasFX, 0, 0, outW, outH);
  }

  async function webCodecsExport({ totalFrames, dt, outW, outH, fps, comp, compCtx, progress }) {
    const Mp4 = window.Mp4Muxer;
    if (!Mp4) throw new Error('mp4-muxer not loaded');

    const muxer = new Mp4.Muxer({
      target: new Mp4.ArrayBufferTarget(),
      video: { codec: 'avc', width: outW, height: outH },
      fastStart: 'in-memory'
    });

    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (encoderError) return;
        try { muxer.addVideoChunk(chunk, meta); }
        catch (e) { encoderError = e; }
      },
      error: (e) => {
        encoderError = e;
        console.error('Encoder error:', e);
      }
    });

    const bitrate = Math.max(1_000_000, Math.round(outW * outH * fps * 0.07));

    const candidates = [
      { codec: 'avc1.42E01E', hw: 'prefer-software' },
      { codec: 'avc1.42E01E', hw: 'no-preference' },
      { codec: 'avc1.42E01E', hw: 'prefer-hardware' },
      { codec: 'avc1.4D401E', hw: 'prefer-software' },
      { codec: 'avc1.4D401E', hw: 'no-preference' },
      { codec: 'avc1.640028', hw: 'prefer-software' },
      { codec: 'avc1.640028', hw: 'prefer-hardware' },
    ];

    let configured = false;
    for (const c of candidates) {
      const cfg = {
        codec: c.codec, width: outW, height: outH,
        bitrate, framerate: fps,
        hardwareAcceleration: c.hw,
        latencyMode: 'realtime',
        bitrateMode: 'constant',
        avc: { format: 'avc' },
      };
      try {
        const support = await VideoEncoder.isConfigSupported(cfg);
        if (!support.supported) continue;
      } catch (e) { continue; }
      const ok = await testEncodeConfig(cfg, outW, outH);
      if (!ok) continue;
      encoder.configure(cfg);
      configured = true;
      break;
    }

    if (!configured) {
      try { encoder.close(); } catch (e) {}
      throw new Error('No AVC encoder configuration accepted the frame format.');
    }

    const channel = new MessageChannel();
    const fastYield = () => new Promise((r) => {
      channel.port1.onmessage = () => r();
      channel.port2.postMessage(0);
    });
    const rafYield = () => new Promise((r) => requestAnimationFrame(() => r()));

    const keyInterval = Math.max(1, Math.round(fps * 2));
    const yieldEvery  = 30;

    let lastFrameIndex = -1;
    let lastMarksKey   = '';
    let lastSettled    = false;

    const isSettled = () => {
      for (const st of App.nodes.values()) {
        if (Math.abs(st.x - st.tx) > 0.01) return false;
        if (Math.abs(st.y - st.ty) > 0.01) return false;
        if (Math.abs(st.s - st.ts) > 0.005) return false;
        if (Math.abs(st.a - st.ta) > 0.005) return false;
      }
      const c = App.camera, t = App.targetCamera;
      if (Math.abs(c.cx - t.cx) > 0.02) return false;
      if (Math.abs(c.cy - t.cy) > 0.02) return false;
      if (Math.abs(c.scale - t.scale) > 0.5) return false;
      return true;
    };

    const marksKey = () => {
      const m = App.marks;
      return `${m.current}|${m.hot ? m.hot.join(',') : ''}|${m.found ? m.found.join(',') : ''}|${m.path ? m.path.join(',') : ''}`;
    };

    try {
      for (let vf = 0; vf < totalFrames; vf++) {
        if (encoderError) throw encoderError;

        advancePlayback(dt, true);

        const frameChanged = App.frameIndex !== lastFrameIndex;
        const markChanged  = marksKey() !== lastMarksKey;
        const settledBefore = isSettled();
        const shouldRender = frameChanged || markChanged || !settledBefore || !lastSettled;

        if (shouldRender) {
          smoothNodes(dt);
          smoothCamera(dt);

          const proj = buildProjection(outW, outH, App.camera);
          const buffers = collectBuffers();
          renderer.draw(proj, buffers.nodeData, buffers.edgeData);

          const f = currentFrame();
          overlay.draw({
            camera: App.camera,
            nodes: App.nodes,
            marks: App.marks,
            bubble: App.bubble,
            opts: App.opts,
            array: f ? f.array : null,
            arrayIndex: f ? f.arrayIndex : -1
          });

          composeFrame(compCtx, outW, outH);

          lastFrameIndex = App.frameIndex;
          lastMarksKey   = marksKey();
          lastSettled    = isSettled();
        }

        const timestamp = Math.round((vf * 1e6) / fps);
        const videoFrame = new VideoFrame(comp, { timestamp, alpha: 'discard' });
        try {
          encoder.encode(videoFrame, { keyFrame: vf % keyInterval === 0 });
        } finally {
          videoFrame.close();
        }

        if (encoder.encodeQueueSize > 30) {
          while (encoder.encodeQueueSize > 20 && !encoderError) {
            await new Promise((r) => setTimeout(r, 4));
          }
        }

        if (vf % yieldEvery === 0) {
          progress.set(vf / totalFrames);
          await fastYield();
        }
      }

      if (encoderError) throw encoderError;

      progress.stage(`Flushing encoder (${encoder.encodeQueueSize} pending)…`);
      await rafYield();
      await encoder.flush();
      encoder.close();

      progress.stage('Packaging MP4…');
      await rafYield();
      muxer.finalize();

      progress.stage('Preparing download…');
      await rafYield();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });

      progress.stage('Saving file…');
      await rafYield();

      return { blob, ext: 'mp4' };
    } catch (e) {
      try { encoder.close(); } catch (e2) {}
      throw e;
    }
  }

  async function mediaRecorderExport({ totalFrames, dt, outW, outH, fps, comp, compCtx, progress }) {
    const stream = comp.captureStream(0);
    const track = stream.getVideoTracks()[0];

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm;codecs=vp8';

    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: Math.max(1_500_000, Math.round(outW * outH * fps * 0.09))
    });

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start();

    for (let vf = 0; vf < totalFrames; vf++) {
      advancePlayback(dt, true);
      smoothNodes(dt);
      smoothCamera(dt);

      const proj = buildProjection(outW, outH, App.camera);
      const buffers = collectBuffers();
      renderer.draw(proj, buffers.nodeData, buffers.edgeData);

      const f = currentFrame();
      overlay.draw({
        camera: App.camera,
        nodes: App.nodes,
        marks: App.marks,
        bubble: App.bubble,
        opts: App.opts,
        array: f ? f.array : null,
        arrayIndex: f ? f.arrayIndex : -1
      });

      composeFrame(compCtx, outW, outH);

      track.requestFrame();
      progress.set(vf / totalFrames);
      await new Promise((r) => setTimeout(r, 1000 / fps / 2));
    }

    progress.stage('Finalising…');
    recorder.stop();
    await done;
    return { blob: new Blob(chunks, { type: 'video/webm' }), ext: 'webm' };
  }

  /* ------------------------------------------------------------------ */
  /*  UI wiring                                                          */
  /* ------------------------------------------------------------------ */

  UI.init({
    onBuild(values) {
      App.nodes.clear();
      renderer.clear();
      overlay.clear();
      sendToWorker({ type: 'build', values });
    },
    onInsert(values) { sendToWorker({ type: 'insert', values }); },
    onSearch(values) { sendToWorker({ type: 'search', values }); },
    onUpdate(pairs)  { sendToWorker({ type: 'update', pairs }); },
    onDelete(values) { sendToWorker({ type: 'delete', values }); },

    onPlayPause() {
      if (App.autoplay || App.exporting) return;
      App.playing = !App.playing;
      UI.setPlaying(App.playing);
    },
    onStep(dir) {
      if (App.autoplay || App.exporting) return;
      App.playing = false;
      UI.setPlaying(false);
      jumpTo(App.frameIndex + dir);
    },
    onScrub(index) {
      if (App.autoplay || App.exporting) return;
      App.playing = false;
      UI.setPlaying(false);
      jumpTo(index);
    },
    onRestart() {
      if (App.autoplay || App.exporting) return;
      jumpTo(0);
      App.playing = true;
      UI.setPlaying(true);
    },
    onAspect(w, h) {
      if (App.exporting) return;
      App.aspect.w = w;
      App.aspect.h = h;
      applyFrameSize(true);
    },
    onOpt(key, value) {
      App.opts[key] = value;

      if (key === 'theme') {
        const theme = THEMES[value] || THEMES.midnight;
        App.theme = theme;
        App.themeName = value;
        applyThemeToFrame(theme);
        renderScene();
      }

      if (key === 'spread' || key === 'nodeR' || key === 'zoom') {
        if (App.frames.length) syncNodes(App.frames[App.frameIndex]);
        updateCameraTarget();
      }
      if (key === 'fontFamily') {
        const stack = (window.FontStacks && window.FontStacks[value]) || 'inherit';
        document.documentElement.style.setProperty('--font-viz', stack);
      }
      if (key === 'master' || key === 'logic' || key === 'pauseSec') {
        updateLengthInfo();
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Wiring extra buttons                                               */
  /* ------------------------------------------------------------------ */

  document.getElementById('btnAutoplay').addEventListener('click', autoplayAll);
  document.getElementById('btnExport').addEventListener('click', openExportModal);
  document.getElementById('exportCancel').addEventListener('click', closeExportModal);
  document.getElementById('exportStart').addEventListener('click', () => {
    const fps = Number(document.getElementById('exportFps').value);
    const quality = Number(document.getElementById('exportQuality').value);
    document.getElementById('exportStart').disabled = true;
    exportVideo(fps, quality).finally(() => {
      document.getElementById('exportStart').disabled = false;
      closeExportModal();
    });
  });

  document.getElementById('btnRandom').addEventListener('click', () => {
    queueMicrotask(() => {
      seedDefaultsFromDataset();
      updateLengthInfo();
    });
  });

  for (const id of ['dataInput', 'insertInput', 'searchInput', 'updateInput', 'deleteInput']) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => setTimeout(updateLengthInfo, 0));
  }
  for (const id of ['exportFps', 'exportQuality']) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => updateLengthInfo());
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  applyThemeToFrame(App.theme);
  applyFrameSize(true);

  const defaultValues = (function () {
    const out = new Set();
    while (out.size < 18) out.add(1 + Math.floor(Math.random() * 99));
    return [...out];
  })();

  document.getElementById('dataInput').value = defaultValues.join(', ');
  seedDefaultsFromDataset();
  updateLengthInfo();

  requestAnimationFrame(tick);
  setTimeout(() => sendToWorker({ type: 'build', values: defaultValues }), 60);
})();