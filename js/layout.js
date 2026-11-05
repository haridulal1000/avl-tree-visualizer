/* ============ js/layout.js ============ */
(function (global) {
  'use strict';

  function computeLayout(tree, opts) {
    opts = opts || {};
    const spread = opts.spread || 1.35;
    const levelH = opts.levelH || 1.15;

    const pos = new Map();
    if (!tree || tree.length === 0) {
      return { pos, rootId: null, bbox: null };
    }

    const byId = new Map();
    for (let i = 0; i < tree.length; i++) byId.set(tree[i].id, tree[i]);

    const childIds = new Set();
    for (let i = 0; i < tree.length; i++) {
      const n = tree[i];
      if (n.left != null) childIds.add(n.left);
      if (n.right != null) childIds.add(n.right);
    }

    let rootId = null;
    for (let i = 0; i < tree.length; i++) {
      if (!childIds.has(tree[i].id)) { rootId = tree[i].id; break; }
    }
    if (rootId === null) return { pos, rootId: null, bbox: null };

    let slot = 0;
    (function walk(id, depth) {
      if (id == null) return;
      const n = byId.get(id);
      if (!n) return;
      walk(n.left, depth + 1);
      pos.set(id, { x: slot * spread, y: depth * levelH });
      slot++;
      walk(n.right, depth + 1);
    })(rootId, 0);

    const mid = ((slot - 1) * spread) / 2;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pos.values()) {
      p.x -= mid;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      pos,
      rootId,
      bbox: { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY }
    };
  }

  global.Layout = { computeLayout };
})(window);