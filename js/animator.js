/* ============ js/animator.js ============ */
'use strict';

let nextId = 1;
let root = null;
let frames = [];

// Current array context that gets attached to every emitted frame.
let _array = [];
let _arrayIndex = -1;

function setArrayContext(arr, idx) {
  _array = arr || [];
  _arrayIndex = idx == null ? -1 : idx;
}

const h   = (n) => (n ? n.height : 0);
const upd = (n) => { n.height = 1 + Math.max(h(n.left), h(n.right)); };
const bf  = (n) => h(n.left) - h(n.right);

function makeNode(key) {
  return { id: nextId++, key, left: null, right: null, height: 1 };
}

function rotateLeft(x) {
  const y = x.right;
  x.right = y.left;
  y.left  = x;
  upd(x); upd(y);
  return y;
}

function rotateRight(y) {
  const x = y.left;
  y.left  = x.right;
  x.right = y;
  upd(y); upd(x);
  return x;
}

function hasKey(key) {
  let cur = root;
  while (cur) {
    if (cur.key === key) return true;
    cur = key < cur.key ? cur.left : cur.right;
  }
  return false;
}

function snapshot() {
  const out = [];
  (function walk(n, depth) {
    if (!n) return;
    walk(n.left, depth + 1);
    out.push({
      id: n.id,
      key: n.key,
      left: n.left ? n.left.id : null,
      right: n.right ? n.right.id : null,
      h: n.height,
      bf: bf(n),
      depth
    });
    walk(n.right, depth + 1);
  })(root, 0);
  return out;
}

function emit(marks, title, detail, log, hold) {
  frames.push({
    tree: snapshot(),
    marks: marks || {},
    bubble: { title: title || '', detail: detail || '' },
    log: log || '',
    hold: hold || 520,
    array: _array.slice(),
    arrayIndex: _arrayIndex
  });
}

/* ------------------------------------------------------------------ */
/*  Rebalance                                                          */
/* ------------------------------------------------------------------ */

function rebalanceFrom(path) {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    upd(node);
    const b = bf(node);
    if (Math.abs(b) < 2) continue;

    emit(
      { hot: [node.id], current: node.id, path: path.map((n) => n.id) },
      `Unbalanced at ${node.key}`,
      `Balance factor ${b > 0 ? '+' + b : b} → a rotation is required`,
      `Rebalance ${node.key} (bf ${b})`,
      720
    );

    let newSub = null;

    if (b > 1) {
      if (bf(node.left) < 0) {
        emit(
          { hot: [node.id, node.left.id], current: node.left.id },
          'Double rotation',
          `Left-Right case — first rotate left around ${node.left.key}`,
          `LR rotation at ${node.key}`,
          640
        );
        node.left = rotateLeft(node.left);
      }
      emit(
        { hot: [node.id], current: node.id },
        'Rotate right',
        `Right rotation around ${node.key}`,
        `Rotate right at ${node.key}`,
        500
      );
      newSub = rotateRight(node);
    } else {
      if (bf(node.right) > 0) {
        emit(
          { hot: [node.id, node.right.id], current: node.right.id },
          'Double rotation',
          `Right-Left case — first rotate right around ${node.right.key}`,
          `RL rotation at ${node.key}`,
          640
        );
        node.right = rotateRight(node.right);
      }
      emit(
        { hot: [node.id], current: node.id },
        'Rotate left',
        `Left rotation around ${node.key}`,
        `Rotate left at ${node.key}`,
        500
      );
      newSub = rotateLeft(node);
    }

    if (i === 0) root = newSub;
    else {
      const p = path[i - 1];
      if (p.left === node) p.left = newSub;
      else if (p.right === node) p.right = newSub;
    }
    path[i] = newSub;

    emit(
      { found: [newSub.id], current: newSub.id, path: path.map((n) => n.id) },
      'Rotation complete',
      `${newSub.key} is now the root of this subtree`,
      'Rotation done',
      720
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Insert                                                             */
/* ------------------------------------------------------------------ */

function opInsert(key) {
  emit({ current: null }, `Insert ${key}`, 'Begin at the root', `Insert ${key}`, 340);

  if (!root) {
    root = makeNode(key);
    emit(
      { found: [root.id], current: root.id },
      `New root ${key}`,
      'The tree was empty',
      `Created root ${key}`,
      620
    );
    return;
  }

  const path = [];
  let cur = root;
  let parent = null;
  let goLeft = false;

  while (cur) {
    path.push(cur);
    if (key === cur.key) {
      emit(
        { found: [cur.id], current: cur.id, path: path.map((n) => n.id) },
        `Duplicate ${key}`,
        'Key already present — insertion skipped',
        `${key} already exists`,
        640
      );
      return;
    }
    parent = cur;
    goLeft = key < cur.key;
    emit(
      { current: cur.id, path: path.map((n) => n.id) },
      `Compare ${key} with ${cur.key}`,
      `${key} is ${goLeft ? 'less' : 'greater'} than ${cur.key} → descend ${goLeft ? 'left' : 'right'}`,
      `Compare ${key} ⇄ ${cur.key}`,
      440
    );
    cur = goLeft ? cur.left : cur.right;
  }

  const node = makeNode(key);
  if (goLeft) parent.left = node;
  else parent.right = node;
  path.push(node);

  emit(
    { found: [node.id], current: node.id, path: path.map((n) => n.id) },
    `Inserted ${key}`,
    `Linked as the ${goLeft ? 'left' : 'right'} child of ${parent.key}`,
    `Inserted ${key} under ${parent.key}`,
    660
  );

  rebalanceFrom(path);
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

function findNode(key) {
  const path = [];
  let cur = root;
  while (cur) {
    path.push(cur);
    if (cur.key === key) return { node: cur, path, found: true };
    const goLeft = key < cur.key;
    emit(
      { current: cur.id, path: path.map((n) => n.id) },
      `Compare ${key} with ${cur.key}`,
      `${key} is ${goLeft ? 'less' : 'greater'} than ${cur.key} → go ${goLeft ? 'left' : 'right'}`,
      `Compare ${key} ⇄ ${cur.key}`,
      420
    );
    cur = goLeft ? cur.left : cur.right;
  }
  return { node: null, path, found: false };
}

function opSearch(key) {
  emit({}, `Search ${key}`, 'Start at the root and compare', `Search ${key}`, 340);
  if (!root) {
    emit({}, 'Tree is empty', 'Nothing to search', 'Empty tree', 600);
    return;
  }
  const res = findNode(key);
  if (res.found) {
    emit(
      { found: [res.node.id], current: res.node.id, path: res.path.map((n) => n.id) },
      `Found ${key}`,
      `Key located at depth ${res.path.length - 1}`,
      `Found ${key}`,
      820
    );
  } else {
    emit(
      { path: res.path.map((n) => n.id) },
      `${key} not found`,
      'A null pointer was reached — the key is absent',
      `${key} not found`,
      760
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Delete                                                             */
/* ------------------------------------------------------------------ */

function removeNode(node, path) {
  let rbPath;
  if (node.left && node.right) {
    emit(
      { found: [node.id], current: node.id, path: path.map((n) => n.id) },
      'Two children',
      'Find the in-order successor: the smallest key in the right subtree',
      `Node ${node.key} has two children`,
      680
    );
    const sp = [node];
    let s = node.right;
    emit(
      { current: s.id, path: path.concat([s]).map((n) => n.id) },
      'Descend right',
      'Then keep going left until there is no left child',
      'Enter right subtree',
      460
    );
    while (s.left) {
      sp.push(s);
      s = s.left;
      emit(
        { current: s.id, path: path.concat(sp).map((n) => n.id) },
        'Go left',
        'Looking for the minimum key',
        'Descend left',
        420
      );
    }
    emit(
      { found: [s.id], current: s.id, hot: [node.id] },
      `Successor is ${s.key}`,
      `Overwrite ${node.key} with ${s.key}, then remove the successor node`,
      `Successor ${s.key}`,
      700
    );
    node.key = s.key;
    const parent = sp[sp.length - 1];
    const child = s.right;
    if (parent === node) node.right = child;
    else parent.left = child;
    emit(
      { hot: [s.id], path: path.map((n) => n.id) },
      `Removed ${s.key}`,
      'The successor node has at most one child — splice it out',
      `Spliced out ${s.key}`,
      700
    );
    rbPath = path.slice(0, path.length - 1).concat(sp);
  } else {
    const child = node.left || node.right;
    const parent = path.length > 1 ? path[path.length - 2] : null;
    if (!parent) root = child;
    else if (parent.left === node) parent.left = child;
    else parent.right = child;
    emit(
      { hot: [node.id], path: path.slice(0, -1).map((n) => n.id) },
      `Removed ${node.key}`,
      child
        ? 'The node has one child — the child takes its place'
        : 'The node is a leaf — it is simply detached',
      `Removed ${node.key}`,
      720
    );
    rbPath = path.slice(0, path.length - 1);
  }
  if (rbPath.length) rebalanceFrom(rbPath);
}

function opDelete(key) {
  emit({}, `Delete ${key}`, 'Locate the node first', `Delete ${key}`, 340);
  if (!root) {
    emit({}, 'Tree is empty', '', 'Empty tree', 600);
    return;
  }
  const res = findNode(key);
  if (!res.found) {
    emit(
      { path: res.path.map((n) => n.id) },
      `${key} not found`,
      'Cannot delete a key that is not in the tree',
      `${key} not found`,
      720
    );
    return;
  }
  emit(
    { found: [res.node.id], current: res.node.id, path: res.path.map((n) => n.id) },
    `Delete ${key}`,
    'Node located — deciding how to remove it',
    '',
    640
  );
  removeNode(res.node, res.path);
}

/* ------------------------------------------------------------------ */
/*  Update                                                             */
/* ------------------------------------------------------------------ */

function opUpdate(oldKey, newKey) {
  emit(
    {},
    `Update ${oldKey} → ${newKey}`,
    'First find the old key, then re-insert using the new key',
    `Update ${oldKey} → ${newKey}`,
    400
  );
  if (oldKey === newKey) {
    emit({}, 'Nothing to do', 'The old and new keys are identical', '', 600);
    return;
  }
  if (hasKey(newKey)) {
    emit(
      {},
      `${newKey} already exists`,
      'Update would create a duplicate — operation cancelled',
      '',
      760
    );
    return;
  }
  const res = findNode(oldKey);
  if (!res.found) {
    emit(
      { path: res.path.map((n) => n.id) },
      `${oldKey} not found`,
      'Update cancelled',
      `${oldKey} not found`,
      700
    );
    return;
  }
  emit(
    { found: [res.node.id], current: res.node.id, path: res.path.map((n) => n.id) },
    `Found ${oldKey}`,
    'Removing the old key before inserting the new one',
    '',
    640
  );
  removeNode(res.node, res.path);
  opInsert(newKey);
}

/* ------------------------------------------------------------------ */
/*  Batch operations (set array context per item)                      */
/* ------------------------------------------------------------------ */

function opBuild(values) {
  nextId = 1;
  root = null;
  frames = [];

  const arr = values.map(String);
  setArrayContext(arr, 0);

  emit(
    {},
    'Build tree',
    `Inserting ${values.length} keys one by one`,
    `Building from ${values.length} keys`,
    500
  );

  for (let i = 0; i < values.length; i++) {
    setArrayContext(arr, i);
    opInsert(values[i]);
  }

  setArrayContext(arr, arr.length - 1);
  emit(
    {},
    'Build complete',
    `The tree now holds ${values.length} keys`,
    'Build complete',
    700
  );
}

function opInsertAll(values) {
  frames = [];
  const arr = values.map(String);
  for (let i = 0; i < values.length; i++) {
    setArrayContext(arr, i);
    opInsert(values[i]);
  }
}

function opSearchAll(values) {
  frames = [];
  const arr = values.map(String);
  for (let i = 0; i < values.length; i++) {
    setArrayContext(arr, i);
    opSearch(values[i]);
  }
}

function opUpdateAll(pairs) {
  frames = [];
  const arr = pairs.map(([a, b]) => `${a}→${b}`);
  for (let i = 0; i < pairs.length; i++) {
    setArrayContext(arr, i);
    opUpdate(pairs[i][0], pairs[i][1]);
  }
}

function opDeleteAll(values) {
  frames = [];
  const arr = values.map(String);
  for (let i = 0; i < values.length; i++) {
    setArrayContext(arr, i);
    opDelete(values[i]);
  }
}

/* ------------------------------------------------------------------ */
/*  Worker messages                                                    */
/* ------------------------------------------------------------------ */

self.onmessage = function (e) {
  const msg = e.data || {};
  const requestId = msg.requestId;
  try {
    switch (msg.type) {
      case 'reset':
        nextId = 1; root = null; frames = [];
        setArrayContext([], -1);
        break;
      case 'build':    opBuild(msg.values || []); break;
      case 'insert':   opInsertAll(msg.values || []); break;
      case 'search':   opSearchAll(msg.values || []); break;
      case 'update':   opUpdateAll(msg.pairs || []); break;
      case 'delete':   opDeleteAll(msg.values || []); break;

      case 'full-sequence': {
        nextId = 1;
        root = null;
        frames = [];

        const build   = msg.build  || [];
        const insert  = msg.insert || [];
        const search  = msg.search || [];
        const update  = msg.update || [];
        const del     = msg.delete || [];
        const pauseMs = Math.max(0, Number(msg.pauseMs) || 0);

        // Extend the hold of the last emitted frame so the current visual
        // state lingers for `pauseMs` before the next group begins.
        // Also applied at the end of the very last group, so the exported
        // video always ends with a natural pause.
        const pauseGroup = () => {
          if (pauseMs <= 0) return;
          const last = frames[frames.length - 1];
          if (last) last.hold += pauseMs;
        };

        if (build.length) {
          const arr = build.map(String);
          setArrayContext(arr, 0);
          emit({}, 'Build tree',
            `Inserting ${build.length} keys one by one`,
            `Building from ${build.length} keys`, 500);
          for (let i = 0; i < build.length; i++) {
            setArrayContext(arr, i);
            opInsert(build[i]);
          }
          setArrayContext(arr, arr.length - 1);
          emit({}, 'Build complete',
            `The tree now holds ${build.length} keys`,
            'Build complete', 700);
          pauseGroup();
        }

        if (insert.length) {
          const arr = insert.map(String);
          for (let i = 0; i < insert.length; i++) {
            setArrayContext(arr, i);
            opInsert(insert[i]);
          }
          pauseGroup();
        }

        if (search.length) {
          const arr = search.map(String);
          for (let i = 0; i < search.length; i++) {
            setArrayContext(arr, i);
            opSearch(search[i]);
          }
          pauseGroup();
        }

        if (update.length) {
          const arr = update.map(([a, b]) => `${a}→${b}`);
          for (let i = 0; i < update.length; i++) {
            setArrayContext(arr, i);
            opUpdate(update[i][0], update[i][1]);
          }
          pauseGroup();
        }

        if (del.length) {
          const arr = del.map(String);
          for (let i = 0; i < del.length; i++) {
            setArrayContext(arr, i);
            opDelete(del[i]);
          }
          pauseGroup();
        }

        break;
      }

      default:
        throw new Error('Unknown message type: ' + msg.type);
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: String((err && err.stack) || err)
    });
    return;
  }
  self.postMessage({ type: 'frames', requestId, frames });
};