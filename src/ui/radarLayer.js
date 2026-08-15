import { getPaletteForProduct, parseColorToRgba, RADAR_PALETTE_SIZE } from "./palettes.js";

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(err || "Shader compile failed");
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(err || "Program link failed");
  }
  return program;
}

export const RadarGLLayer = L.Layer.extend({
  initialize(polarData, decoded, options) {
    this._polarData = polarData;
    this._decoded = decoded;
    this._opacity = options?.opacity ?? 0.85;
    this._raf = null;
    this._canvas = document.createElement("canvas");
    this._canvas.className = "leaflet-zoom-animated";
    this._canvas.style.position = "absolute";
    this._canvas.style.pointerEvents = "none";
    this._canvas.style.zIndex = "220";
    this._gl = this._canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!this._gl) throw new Error("WebGL not supported in this browser");
    this._initGlObjects();
    this._uploadDataTextures();
  },

  _initGlObjects() {
    const gl = this._gl;
    const fragPrecision = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision || 0) > 0
      ? "highp" : "mediump";
    const vsSource = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;
    const fsSource = `
      precision ${fragPrecision} float;
      uniform vec2 u_resolution;
      uniform vec2 u_centerPx;
      uniform float u_maxRangePx;
      uniform float u_maxRangeM;
      uniform float u_rangeStartM;
      uniform float u_rangeStepM;
      uniform float u_numGates;
      uniform float u_numAz;
      uniform float u_azStartDeg;
      uniform float u_layerOpacity;
      uniform sampler2D u_gateTex;
      uniform sampler2D u_paletteTex;

      void main() {
        vec2 fragTopLeft = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
        vec2 d = fragTopLeft - u_centerPx;
        float rPx = length(d);
        if (rPx > u_maxRangePx || u_maxRangePx <= 0.0) discard;

        float rangeM = (rPx / u_maxRangePx) * u_maxRangeM;
        float gateF = (rangeM - u_rangeStartM) / u_rangeStepM;
        if (gateF < 0.0 || gateF >= u_numGates) discard;
        float gateIdx = clamp(floor(gateF), 0.0, u_numGates - 1.0);

        float theta = degrees(atan(d.x, -d.y));
        if (theta < 0.0) theta += 360.0;
        float azNorm = mod(theta - u_azStartDeg + 360.0, 360.0);
        float azIdx = clamp(floor((azNorm / 360.0) * u_numAz), 0.0, u_numAz - 1.0);

        float u = (gateIdx + 0.5) / u_numGates;
        float v = (azIdx + 0.5) / u_numAz;
        float cNorm = texture2D(u_gateTex, vec2(u, v)).r;
        float cIdx = clamp(floor(cNorm * 255.0 + 0.5), 0.0, ${(RADAR_PALETTE_SIZE - 1).toFixed(1)});
        if (cIdx < 0.5) discard;

        float pu = (cIdx + 0.5) / ${RADAR_PALETTE_SIZE.toFixed(1)};
        vec4 color = texture2D(u_paletteTex, vec2(pu, 0.5));
        color.a *= u_layerOpacity;
        if (color.a <= 0.0) discard;
        gl_FragColor = color;
      }
    `;

    this._program = createProgram(gl, vsSource, fsSource);
    gl.useProgram(this._program);
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    this._aPos = gl.getAttribLocation(this._program, "a_pos");
    gl.enableVertexAttribArray(this._aPos);
    gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 0, 0);

    this._uResolution = gl.getUniformLocation(this._program, "u_resolution");
    this._uCenterPx = gl.getUniformLocation(this._program, "u_centerPx");
    this._uMaxRangePx = gl.getUniformLocation(this._program, "u_maxRangePx");
    this._uMaxRangeM = gl.getUniformLocation(this._program, "u_maxRangeM");
    this._uRangeStartM = gl.getUniformLocation(this._program, "u_rangeStartM");
    this._uRangeStepM = gl.getUniformLocation(this._program, "u_rangeStepM");
    this._uNumGates = gl.getUniformLocation(this._program, "u_numGates");
    this._uNumAz = gl.getUniformLocation(this._program, "u_numAz");
    this._uAzStartDeg = gl.getUniformLocation(this._program, "u_azStartDeg");
    this._uLayerOpacity = gl.getUniformLocation(this._program, "u_layerOpacity");

    this._gateTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._gateTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(this._program, "u_gateTex"), 0);

    this._paletteTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(this._program, "u_paletteTex"), 1);
  },

  _uploadDataTextures() {
    const gl = this._gl;
    const d = this._polarData;
    const dec = this._decoded;
    gl.useProgram(this._program);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._gateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, d.num_gates, d.num_azimuths, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, dec.values);

    const palette = new Uint8Array(RADAR_PALETTE_SIZE * 4);
    const colors = getPaletteForProduct(d.product);
    for (let i = 0; i < RADAR_PALETTE_SIZE; i++) {
      const rgba = parseColorToRgba(colors[i] || null);
      palette.set(rgba, i * 4);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, RADAR_PALETTE_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette);
  },

  onAdd(map) {
    this._map = map;
    map.getPane("overlayPane").appendChild(this._canvas);
    map.on("move zoom resize viewreset", this._scheduleRender, this);
    this._scheduleRender();
    return this;
  },

  onRemove(map) {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    map.off("move zoom resize viewreset", this._scheduleRender, this);
    this._canvas.parentNode?.removeChild(this._canvas);
    this._map = null;
    return this;
  },

  setData(polarData, decoded) {
    this._polarData = polarData;
    this._decoded = decoded;
    this._uploadDataTextures();
    this._scheduleRender();
    return this;
  },

  _scheduleRender() {
    if (!this._map) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);
    const mapSize = this._map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(mapSize.x * dpr));
    const h = Math.max(1, Math.round(mapSize.y * dpr));
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
      this._canvas.style.width = `${mapSize.x}px`;
      this._canvas.style.height = `${mapSize.y}px`;
    }
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._render();
    });
  },

  _render() {
    if (!this._map) return;
    const gl = this._gl;
    const d = this._polarData;
    const dec = this._decoded;
    if (!d || !dec) return;
    const dpr = window.devicePixelRatio || 1;
    const mapSize = this._map.getSize();
    const width = Math.max(1, Math.round(mapSize.x * dpr));
    const height = Math.max(1, Math.round(mapSize.y * dpr));
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this._program);

    const center = this._map.latLngToContainerPoint([d.lat, d.lon]);
    const maxRangeM = d.range_start_m + d.num_gates * d.range_step_m;
    const dlat = maxRangeM / 111000;
    const edge = this._map.latLngToContainerPoint([d.lat + dlat, d.lon]);
    const maxRangePx = Math.max(1, Math.hypot(edge.x - center.x, edge.y - center.y) * dpr);

    gl.uniform2f(this._uResolution, width, height);
    gl.uniform2f(this._uCenterPx, center.x * dpr, center.y * dpr);
    gl.uniform1f(this._uMaxRangePx, maxRangePx);
    gl.uniform1f(this._uMaxRangeM, maxRangeM);
    gl.uniform1f(this._uRangeStartM, d.range_start_m);
    gl.uniform1f(this._uRangeStepM, d.range_step_m);
    gl.uniform1f(this._uNumGates, d.num_gates);
    gl.uniform1f(this._uNumAz, d.num_azimuths);
    gl.uniform1f(this._uAzStartDeg, dec.azimuthStartDeg || 0);
    gl.uniform1f(this._uLayerOpacity, this._opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },
});
