/* ============ js/overlay.js ============ */
(function (global) {
  'use strict';

  const FONTS = {
    system:  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    sans:    'Arial, Helvetica, sans-serif',
    serif:   'Georgia, "Times New Roman", serif',
    mono:    'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    rounded: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif'
  };

  function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth) {
    if (!text) return [];
    const words = String(text).split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  class Overlay {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.W = 1;
      this.H = 1;
    }

    resize(cssW, cssH, dpr) {
      this.dpr = dpr;
      this.W = cssW;
      this.H = cssH;
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    clear() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    screen(x, y, cam) {
      return [
        (x - cam.cx) * cam.scale + this.W / 2,
        (y - cam.cy) * cam.scale + this.H / 2
      ];
    }

    draw(state) {
      this.clear();
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._drawLabels(state);
      this._drawArrayStrip(state);
      this._drawBubble(state);
    }

    /* ---------------- node labels ---------------- */

    _drawLabels(state) {
      const o = state.opts;
      if (!o.showValues && !o.showHeights && !o.showBF) return;

      const ctx = this.ctx;
      const cam = state.camera;
      const fam = FONTS[o.fontFamily] || FONTS.system;
      const scale = o.labelScale || 1;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const st of state.nodes.values()) {
        if (st.a < 0.05) continue;

        const [x, y] = this.screen(st.x, st.y, cam);
        const r = o.nodeR * st.s * cam.scale;
        if (r < 4) continue;

        ctx.globalAlpha = st.a;
        const hasSub = o.showHeights || o.showBF;

        if (o.showValues) {
          const fs = Math.max(9, Math.min(r * 0.92, 34)) * scale;
          ctx.font = `700 ${fs}px ${fam}`;
          ctx.fillStyle = '#eaf4ff';
          ctx.fillText(String(st.key), x, y + (hasSub ? -fs * 0.14 : 0));
        }

        if (hasSub) {
          const fs2 = Math.max(8, Math.min(r * 0.40, 13)) * scale;
          ctx.font = `600 ${fs2}px ${FONTS.mono}`;
          ctx.fillStyle = 'rgba(150,200,255,.78)';
          let txt = '';
          if (o.showHeights) txt += 'h' + st.h;
          if (o.showBF) {
            const sign = st.bf > 0 ? '+' : '';
            txt += (txt ? ' ' : '') + sign + st.bf;
          }
          ctx.fillText(txt, x, y + r * 0.50);
        }
      }
      ctx.globalAlpha = 1;
    }

    /* ---------------- array strip with cursor ---------------- */

    _drawArrayStrip(state) {
      const arr = state.array;
      if (!arr || !arr.length) return;

      const ctx = this.ctx;
      const idx = state.arrayIndex;
      const n = arr.length;

      const maxW = this.W * 0.86;
      const gap = Math.max(4, Math.min(8, this.W * 0.006));
      const itemH = Math.max(24, Math.min(34, this.H * 0.05));
      const fontPx = Math.max(11, Math.min(15, itemH * 0.48));
      const padX = Math.max(6, fontPx * 0.7);

      ctx.font = `600 ${fontPx}px ${FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const rawWidths = arr.map((v) => ctx.measureText(String(v)).width + padX * 2);
      let totalW = rawWidths.reduce((a, b) => a + b, 0) + (n - 1) * gap;
      let widths = rawWidths;

      if (totalW > maxW) {
        const k = maxW / totalW;
        widths = rawWidths.map((w) => w * k);
        totalW = maxW;
      }

      const startX = (this.W - totalW) / 2;
      const yTop = this.H - itemH - Math.min(70, this.H * 0.09);
      const yBot = yTop + itemH;

      ctx.strokeStyle = 'rgba(90,150,220,.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX, yBot + 4);
      ctx.lineTo(startX + totalW, yBot + 4);
      ctx.stroke();

      let x = startX;
      for (let i = 0; i < n; i++) {
        const w = widths[i];
        const cx = x + w / 2;
        const isCur = i === idx;

        const bg = isCur ? 'rgba(60,180,255,.55)' : 'rgba(28,44,70,.75)';
        const border = isCur ? 'rgba(120,220,255,1)' : 'rgba(90,140,220,.32)';

        ctx.fillStyle = bg;
        ctx.strokeStyle = border;
        ctx.lineWidth = isCur ? 2 : 1;
        roundRect(ctx, x, yTop, w, itemH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isCur ? '#ffffff' : '#9fb6d4';
        ctx.fillText(String(arr[i]), cx, yTop + itemH / 2 + 0.5);

        if (isCur) {
          ctx.fillStyle = 'rgba(120,220,255,1)';
          ctx.beginPath();
          ctx.moveTo(cx, yTop - 3);
          ctx.lineTo(cx - 6, yTop - 12);
          ctx.lineTo(cx + 6, yTop - 12);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = 'rgba(120,220,255,.22)';
          roundRect(ctx, x - 2, yTop - 2, w + 4, itemH + 4, 8);
          ctx.fill();
        }

        x += w + gap;
      }
    }

    /* ---------------- think box (drawn on canvas) ---------------- */

    _pickAnchor(state) {
      const marks = state.marks || {};
      const nodes = state.nodes;
      const alive = (n) => n && n.a > 0.15;

      if (marks.current != null) {
        const n = nodes.get(marks.current);
        if (alive(n)) return n;
      }
      if (marks.hot) {
        for (const id of marks.hot) {
          const n = nodes.get(id);
          if (alive(n)) return n;
        }
      }
      if (marks.found) {
        for (const id of marks.found) {
          const n = nodes.get(id);
          if (alive(n)) return n;
        }
      }
      if (marks.path && marks.path.length) {
        for (let i = marks.path.length - 1; i >= 0; i--) {
          const n = nodes.get(marks.path[i]);
          if (alive(n)) return n;
        }
      }
      return null;
    }

    _drawBubble(state) {
      const bub = state.bubble;
      if (!bub || (!bub.title && !bub.detail)) return;

      const ctx = this.ctx;
      const o = state.opts;
      const scale = o.bubbleScale || 1;
      const fam = FONTS[o.fontFamily] || FONTS.system;

      const titleSize = 13 * scale;
      const detailSize = 12 * scale;
      const lineHeightDetail = detailSize * 1.45;
      const padX = 14;
      const padTop = 10;
      const padBottom = 12;
      const gapTitle = 3;
      const minW = 180;
      const maxW = 340;
      const innerMaxW = maxW - padX * 2;

      ctx.save();
      try {
        // Measure title.
        ctx.font = `700 ${titleSize}px ${fam}`;
        const titleW = bub.title ? ctx.measureText(bub.title).width : 0;

        // Wrap detail.
        ctx.font = `${detailSize}px ${fam}`;
        const detailLines = wrapText(ctx, bub.detail || '', innerMaxW);
        let detailW = 0;
        for (const line of detailLines) {
          const w = ctx.measureText(line).width;
          if (w > detailW) detailW = w;
        }

        const hasTitle = !!bub.title;
        const hasDetail = detailLines.length > 0 && !!bub.detail;

        const contentW = Math.max(titleW, detailW);
        const boxW = Math.max(minW, Math.min(maxW, contentW + padX * 2));
        const titleBlock = hasTitle ? titleSize + gapTitle : 0;
        const detailBlock = hasDetail ? detailLines.length * lineHeightDetail : 0;
        const boxH = padTop + titleBlock + detailBlock + padBottom;

        // Anchor.
        const node = this._pickAnchor(state);
        let anchorX = this.W / 2;
        let anchorY = 0;
        let radius = 0;
        if (node) {
          const [sx, sy] = this.screen(node.x, node.y, state.camera);
          anchorX = sx;
          anchorY = sy;
          radius = o.nodeR * node.s * state.camera.scale;
        }

        const gap = 14;
        const edge = 8;
        const halfW = boxW / 2 + edge;
        const clampedX = Math.max(halfW, Math.min(this.W - halfW, anchorX));

        let mode = 'none';
        let boxY = edge;

        if (node) {
          const aboveY = anchorY - radius - gap - boxH;
          const belowY = anchorY + radius + gap;
          if (aboveY >= edge) {
            mode = 'above';
            boxY = aboveY;
          } else if (belowY + boxH <= this.H - edge) {
            mode = 'below';
            boxY = belowY;
          } else {
            mode = 'above';
            boxY = edge;
          }
        }

        const boxX = clampedX - boxW / 2;

        // Bubble body.
        roundRect(ctx, boxX, boxY, boxW, boxH, 10);
        ctx.fillStyle = '#0d1520';
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,180,255,.38)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Arrow pointing at the node.
        if (node && mode !== 'none') {
          const arrowX = Math.max(boxX + 12, Math.min(boxX + boxW - 12, anchorX));

          if (mode === 'above') {
            const baseY = boxY + boxH;
            const tipY = baseY + 8;
            ctx.beginPath();
            ctx.moveTo(arrowX - 6, baseY);
            ctx.lineTo(arrowX, tipY);
            ctx.lineTo(arrowX + 6, baseY);
            ctx.closePath();
            ctx.fillStyle = '#0d1520';
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(arrowX - 6, baseY);
            ctx.lineTo(arrowX, tipY);
            ctx.lineTo(arrowX + 6, baseY);
            ctx.strokeStyle = 'rgba(90,180,255,.38)';
            ctx.stroke();
          } else {
            const baseY = boxY;
            const tipY = baseY - 8;
            ctx.beginPath();
            ctx.moveTo(arrowX - 6, baseY);
            ctx.lineTo(arrowX, tipY);
            ctx.lineTo(arrowX + 6, baseY);
            ctx.closePath();
            ctx.fillStyle = '#0d1520';
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(arrowX - 6, baseY);
            ctx.lineTo(arrowX, tipY);
            ctx.lineTo(arrowX + 6, baseY);
            ctx.strokeStyle = 'rgba(90,180,255,.38)';
            ctx.stroke();
          }
        }

        // Text.
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let ty = boxY + padTop;

        if (hasTitle) {
          ctx.font = `700 ${titleSize}px ${fam}`;
          ctx.fillStyle = '#bfe7ff';
          ctx.fillText(bub.title, boxX + padX, ty);
          ty += titleSize + gapTitle;
        }

        if (hasDetail) {
          ctx.font = `${detailSize}px ${fam}`;
          ctx.fillStyle = '#94a8c4';
          for (const line of detailLines) {
            ctx.fillText(line, boxX + padX, ty);
            ty += lineHeightDetail;
          }
        }
      } finally {
        ctx.restore();
      }
    }
  }

  global.Overlay = Overlay;
  global.FontStacks = FONTS;
})(window);