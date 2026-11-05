/* ============ js/ui.js ============ */
(function (global) {
  "use strict";

  function parseNumbers(str) {
    return String(str || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)
      .filter((n) => Number.isFinite(n));
  }

  function parsePairs(str) {
    return String(str || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const parts = s.split(":").map((p) => p.trim());
        if (parts.length !== 2) return null;
        const a = Number(parts[0]);
        const b = Number(parts[1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        return [a, b];
      })
      .filter(Boolean);
  }

  function randomValues(n) {
    const out = new Set();
    const max = Math.max(99, n * 3);
    let guard = 0;
    while (out.size < n && guard++ < 10000) {
      out.add(1 + Math.floor(Math.random() * max));
    }
    return [...out];
  }

  function initTooltips() {
    const tip = document.getElementById("tip");
    let active = null;

    function show(el) {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      active = el;
      tip.textContent = text;
      tip.style.visibility = "hidden";
      tip.classList.add("show");

      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const r = el.getBoundingClientRect();

      let left = r.right + 12;
      let side = "";
      if (left + tw > window.innerWidth - 8) {
        left = r.left - tw - 12;
        side = "left";
      }
      left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
      let top = r.top + r.height / 2;
      top = Math.max(
        th / 2 + 8,
        Math.min(window.innerHeight - th / 2 - 8, top),
      );

      tip.style.left = left + "px";
      tip.style.top = top + "px";
      tip.style.visibility = "";
      tip.className = "tip show" + (side ? " " + side : "");
    }

    function hide() {
      active = null;
      tip.classList.remove("show");
    }

    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (el && el !== active) show(el);
    });
    document.addEventListener("mouseout", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (!el) return;
      const to = e.relatedTarget;
      if (to && el.contains(to)) return;
      hide();
    });
    document.addEventListener("focusin", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (el) show(el);
    });
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
  }

  const UI = {
    handlers: {},
    lastLoggedIndex: -1,
    FONTS: global.FontStacks,

    init(handlers) {
      this.handlers = handlers || {};
      const self = this;
      const $ = (id) => document.getElementById(id);

      initTooltips();

      const dataInput = $("dataInput");
      const randCount = $("randCount");
      const vRandCount = $("vRandCount");

      const fillRandom = () => {
        const n = Number(randCount.value);
        vRandCount.textContent = n;
        dataInput.value = randomValues(n).join(", ");
      };

      randCount.addEventListener("input", () => {
        vRandCount.textContent = randCount.value;
      });

      $("btnRandom").addEventListener("click", fillRandom);
      $("btnBuild").addEventListener("click", () => {
        const vals = parseNumbers(dataInput.value);
        if (!vals.length) return;
        self.call("onBuild", vals);
      });

      $("btnInsert").addEventListener("click", () => {
        const vals = parseNumbers($("insertInput").value);
        if (vals.length) self.call("onInsert", vals);
      });
      $("btnSearch").addEventListener("click", () => {
        const vals = parseNumbers($("searchInput").value);
        if (vals.length) self.call("onSearch", vals);
      });
      $("btnUpdate").addEventListener("click", () => {
        const pairs = parsePairs($("updateInput").value);
        if (pairs.length) self.call("onUpdate", pairs);
      });
      $("btnDelete").addEventListener("click", () => {
        const vals = parseNumbers($("deleteInput").value);
        if (vals.length) self.call("onDelete", vals);
      });

      $("btnPlay").addEventListener("click", () => self.call("onPlayPause"));
      $("btnStepBack").addEventListener("click", () => self.call("onStep", -1));
      $("btnStepFwd").addEventListener("click", () => self.call("onStep", 1));
      $("btnRestart").addEventListener("click", () => self.call("onRestart"));
      $("scrub").addEventListener("input", (e) =>
        self.call("onScrub", Number(e.target.value)),
      );

      const bindSlider = (sliderId, labelId, key, fmt) => {
        const s = $(sliderId);
        const l = $(labelId);
        const apply = () => {
          const v = Number(s.value);
          l.textContent = fmt ? fmt(v) : v.toFixed(2);
          self.call("onOpt", key, v);
        };
        s.addEventListener("input", apply);
        apply();
      };

      bindSlider("sSpeed", "vSpeed", "master", (v) => v.toFixed(2) + "×");
      bindSlider("sLogic", "vLogic", "logic", (v) => v.toFixed(2) + "×");
      bindSlider("sStruct", "vStruct", "struct", (v) => v.toFixed(2) + "×");
      bindSlider("sCamera", "vCamera", "cameraSp", (v) => v.toFixed(2) + "×");
      bindSlider("sSpread", "vSpread", "spread", (v) => v.toFixed(2));
      bindSlider("sNode", "vNode", "nodeR", (v) => v.toFixed(2));
      bindSlider("sZoom", "vZoom", "zoom", (v) => v.toFixed(2) + "×");
      bindSlider("sFont", "vFont", "labelScale", (v) => v.toFixed(2) + "×");
      bindSlider(
        "sBubble",
        "vBubble",
        "bubbleScale",
        (v) => v.toFixed(2) + "×",
      );
      bindSlider(
        "sBubble",
        "vBubble",
        "bubbleScale",
        (v) => v.toFixed(2) + "×",
      );
       bindSlider('sPause',  'vPause',  'pauseSec',    (v) => v.toFixed(1) + 's'); 

      const bindToggle = (id, key) => {
        const el = $(id);
        const apply = () => self.call("onOpt", key, el.checked);
        el.addEventListener("change", apply);
        apply();
      };
      bindToggle("cValues", "showValues");
      bindToggle("cHeights", "showHeights");
      bindToggle("cBF", "showBF");
      bindToggle("cFlow", "showFlow");

      const fontFamily = $("fontFamily");
      fontFamily.addEventListener("change", () =>
        self.call("onOpt", "fontFamily", fontFamily.value),
      );
      self.call("onOpt", "fontFamily", fontFamily.value);

      const preset = $("aspectPreset");
      const aspW = $("aspectW");
      const aspH = $("aspectH");

      const applyAspect = (fromPreset) => {
        let w, h;
        if (fromPreset) {
          const v = preset.value;
          if (v === "custom") return;
          const parts = v.split(":").map(Number);
          w = parts[0];
          h = parts[1];
          aspW.value = String(w);
          aspH.value = String(h);
        } else {
          w = Math.max(1, Math.min(100, Math.round(Number(aspW.value) || 16)));
          h = Math.max(1, Math.min(100, Math.round(Number(aspH.value) || 9)));
          const key = w + ":" + h;
          const found = Array.prototype.some.call(
            preset.options,
            (o) => o.value === key,
          );
          preset.value = found ? key : "custom";
        }
        self.call("onAspect", w, h);
      };

      preset.addEventListener("change", () => applyAspect(true));
      aspW.addEventListener("change", () => applyAspect(false));
      aspH.addEventListener("change", () => applyAspect(false));
            /* ---------- background theme ---------- */
      const themeSelect = $('themeSelect');
      themeSelect.addEventListener('change', () => {
        self.call('onOpt', 'theme', themeSelect.value);
      });
      self.call('onOpt', 'theme', themeSelect.value);

      fillRandom();
      requestAnimationFrame(() => applyAspect(true));
    },

    call(name, ...args) {
      const fn = this.handlers[name];
      if (typeof fn === "function") fn(...args);
    },

    setPlaying(playing) {
      document.getElementById("btnPlay").textContent = playing
        ? "Pause"
        : "Play";
    },

    updatePlayback(index, total) {
      const scrub = document.getElementById("scrub");
      const label = document.getElementById("frameLabel");
      scrub.max = String(Math.max(0, total - 1));
      scrub.value = String(index);
      label.textContent = `${index + 1} / ${total}`;
    },

    setStatus(text) {
      document.getElementById("status").textContent = text || "";
    },

    pushLog(text, index) {
      if (!text) return;
      const log = document.getElementById("log");
      if (index !== this.lastLoggedIndex + 1) log.innerHTML = "";
      this.lastLoggedIndex = index;
      const row = document.createElement("div");
      row.textContent = "› " + text;
      log.appendChild(row);
      while (log.children.length > 60) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
    },

    resetLog() {
      document.getElementById("log").innerHTML = "";
      this.lastLoggedIndex = -1;
    },

    notify(msg) {
      document.getElementById("status").textContent = msg;
    },
  };

  global.UI = UI;
})(window);
