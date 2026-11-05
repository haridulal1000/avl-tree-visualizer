/* ============ js/renderer.js ============ */
(function (global) {
  'use strict';

  const VS_NODE = `#version 300 es
    layout(location=0) in vec2 aCorner;
    layout(location=1) in vec2 iPos;
    layout(location=2) in float iRadius;
    layout(location=3) in vec3 iFill;
    layout(location=4) in vec3 iRing;
    layout(location=5) in float iGlow;

    uniform mat4 uProj;

    out vec2 vUV;
    out vec3 vFill;
    out vec3 vRing;
    out float vGlow;

    void main() {
      vec2 world = iPos + aCorner * iRadius;
      gl_Position = uProj * vec4(world, 0.0, 1.0);
      vUV   = aCorner;
      vFill = iFill;
      vRing = iRing;
      vGlow = iGlow;
    }`;

  const FS_NODE = `#version 300 es
    precision highp float;

    in vec2 vUV;
    in vec3 vFill;
    in vec3 vRing;
    in float vGlow;

    out vec4 outColor;

    void main() {
      float d  = length(vUV);
      float aa = max(fwidth(d), 0.0025);
      float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
      if (mask < 0.004) discard;

      float shade = smoothstep(0.55, 1.0, d) * 0.16;
      vec3 fill = vFill * (1.0 - shade);

      float border = smoothstep(0.92 - aa, 1.0 - aa, d);
      vec3 col = mix(fill, vRing, border * 0.55);

      outColor = vec4(col, mask);
    }`;

  const VS_EDGE = `#version 300 es
    layout(location=0) in vec2 aCorner;
    layout(location=1) in vec2 iA;
    layout(location=2) in vec2 iB;
    layout(location=3) in float iWidth;
    layout(location=4) in vec4 iColor;

    uniform mat4 uProj;

    out vec2 vLocal;
    out vec4 vColor;

    void main() {
      vec2  d   = iB - iA;
      float len = length(d);
      vec2  dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
      vec2  nrm = vec2(-dir.y, dir.x);

      vec2 world = iA + dir * (aCorner.x * len) + nrm * (aCorner.y * iWidth);

      gl_Position = uProj * vec4(world, 0.0, 1.0);
      vLocal = aCorner;
      vColor = iColor;
    }`;

  const FS_EDGE = `#version 300 es
    precision highp float;

    in vec2 vLocal;
    in vec4 vColor;

    out vec4 outColor;

    void main() {
      float ay   = abs(vLocal.y);
      float core = 1.0 - smoothstep(0.15, 1.0, ay);
      float a    = core * vColor.a;
      if (a < 0.003) discard;
      outColor = vec4(vColor.rgb, a);
    }`;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', {
        alpha: true,               // transparent — CSS background shows through
        antialias: true,
        premultipliedAlpha: true,  // canvas stores premultiplied pixels
        preserveDrawingBuffer: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance'
      });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;

      this.quadVerts = new Float32Array([
        -1, -1, 1, -1, 1, 1,
        -1, -1, 1,  1, -1, 1
      ]);

      this.edgeVerts = new Float32Array([
        0, -1, 1, -1, 1, 1,
        0, -1, 1,  1, 0, 1
      ]);

      this._initNodeProgram();
      this._initEdgeProgram();

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);   // transparent clear
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    _compile(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error('Shader compile error: ' + info);
      }
      return sh;
    }

    _link(vsSrc, fsSrc) {
      const gl = this.gl;
      const vs = this._compile(gl.VERTEX_SHADER, vsSrc);
      const fs = this._compile(gl.FRAGMENT_SHADER, fsSrc);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return prog;
    }

    _initNodeProgram() {
      const gl = this.gl;
      this.nodeProg = this._link(VS_NODE, FS_NODE);
      this.nodeProjLoc = gl.getUniformLocation(this.nodeProg, 'uProj');

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const cornerBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.quadVerts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      const stride = 10 * 4;

      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
      gl.vertexAttribDivisor(2, 1);

      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribDivisor(3, 1);

      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 24);
      gl.vertexAttribDivisor(4, 1);

      gl.enableVertexAttribArray(5);
      gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 36);
      gl.vertexAttribDivisor(5, 1);

      gl.bindVertexArray(null);
      this.nodeVAO = vao;
      this.nodeInstBuf = instBuf;
    }

    _initEdgeProgram() {
      const gl = this.gl;
      this.edgeProg = this._link(VS_EDGE, FS_EDGE);
      this.edgeProjLoc = gl.getUniformLocation(this.edgeProg, 'uProj');

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const cornerBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.edgeVerts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      const stride = 9 * 4;

      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
      gl.vertexAttribDivisor(2, 1);

      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(3, 1);

      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 20);
      gl.vertexAttribDivisor(4, 1);

      gl.bindVertexArray(null);
      this.edgeVAO = vao;
      this.edgeInstBuf = instBuf;
    }

    resize(cssW, cssH, dpr) {
      const gl = this.gl;
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    }

    clear() {
      const gl = this.gl;
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    draw(proj, nodeData, edgeData) {
      const gl = this.gl;
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (edgeData.length > 0) {
        gl.useProgram(this.edgeProg);
        gl.bindVertexArray(this.edgeVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeInstBuf);
        gl.bufferData(gl.ARRAY_BUFFER, edgeData, gl.DYNAMIC_DRAW);
        gl.uniformMatrix4fv(this.edgeProjLoc, false, proj);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, edgeData.length / 9);
      }

      if (nodeData.length > 0) {
        gl.useProgram(this.nodeProg);
        gl.bindVertexArray(this.nodeVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeInstBuf);
        gl.bufferData(gl.ARRAY_BUFFER, nodeData, gl.DYNAMIC_DRAW);
        gl.uniformMatrix4fv(this.nodeProjLoc, false, proj);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, nodeData.length / 10);
      }

      gl.bindVertexArray(null);
    }
  }

  global.Renderer = Renderer;
})(window);