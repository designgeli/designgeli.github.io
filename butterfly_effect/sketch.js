/*
  蝴蝶效應 — Butterfly Effect
  GPU-driven dual Lorenz attractor particle system

  Phase 1  Flying side by side  比翼雙飛
    Two Lorenz butterfly manifolds orbit in 3-D, auto-rotating.
  Phase 2  Ephemeral Glimpse    轉瞬浮光
    Mouse cursor breaks the attractor; particles respond to mouse
    ripples and (optionally) microphone audio.
  Phase 3  Eternal Return       永恆輪迴
    Long-press right-click → reset to Phase 1.
*/

const N_MAX = 800_000;   // total particles (400k per wing)

// ─── State ────────────────────────────────────────────────────────────────────
const Phase = { P1: 0, P2: 1 };
let phase        = Phase.P1;
let transition   = 0.0;   // 0 = Phase1, 1 = Phase2 (smoothed)
let rightTimer   = 0.0;   // right-click hold duration (seconds)
let mouseEnergy  = 0.0;   // [0,1] energy near cursor
let mouseSilent  = 999;   // frames since last mouse move

// ─── Rotation ─────────────────────────────────────────────────────────────────
let autoRotY = 0.0;
let rotX     = 0.30;   // fixed slight downward tilt
let rotY     = 0.0;

// ─── Audio ────────────────────────────────────────────────────────────────────
let audioCtx, analyser, freqData;
let audioBands = [0, 0, 0];   // [bass, mid, treble]

// ─── WebGL handles ────────────────────────────────────────────────────────────
let gl, W, H;
let sh;
let ping, pong;
let initData;   // cached initial particle data (for Phase-3 reset)

// ─── p5 WebGL2 context override (khlorghaal technique) ────────────────────────
p5.RendererGL.prototype._initContext = function () {
  this.drawingContext = this.canvas.getContext('webgl2', this._pInst._glAttributes);
  if (!this.drawingContext) alert('WebGL2 not available in this browser.');
  gl = this.drawingContext;
};

// ─── Particle initialisation ─────────────────────────────────────────────────
function makeParticleData(n) {
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const pd  = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const wing = i < n / 2 ? 0 : 1;
    // Scatter within the Lorenz bounding box so particles settle quickly
    pos[i*3+0] = (Math.random() - 0.5) * 32;
    pos[i*3+1] = (Math.random() - 0.5) * 44;
    pos[i*3+2] = Math.random() * 42 + 4;   // z in [4, 46]
    // vel starts at zero
    pd[i*2+0] = wing;
    pd[i*2+1] = Math.random();
  }
  return { pos, vel, pd };
}

// ─── GPU buffer pair ──────────────────────────────────────────────────────────
function makeBuf(pos, vel, pd) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo_p = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo_p);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const vbo_v = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo_v);
  gl.bufferData(gl.ARRAY_BUFFER, vel, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const vbo_d = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo_d);
  gl.bufferData(gl.ARRAY_BUFFER, pd, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  const xfb = gl.createTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, xfb);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, vbo_p);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, vbo_v);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, vbo_d);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

  return { vao, xfb, vbo_p, vbo_v, vbo_d };
}

function pingpong() { [ping, pong] = [pong, ping]; }

// ─── Rotation matrix (Rx * Ry, column-major for WebGL) ───────────────────────
function rotMat3(rx, ry) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  return [
    cy,       sx * sy,  -cx * sy,   // col 0
    0,        cx,        sx,        // col 1
    sy,      -sx * cy,   cx * cy    // col 2
  ];
}

// ─── Audio (optional microphone input) ───────────────────────────────────────
function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        audioCtx.createMediaStreamSource(stream).connect(analyser);
      })
      .catch(() => { /* no mic — audio just stays at 0 */ });
  } catch (_) { /* AudioContext not supported */ }
}

function updateAudio() {
  if (!analyser) return;
  analyser.getByteFrequencyData(freqData);
  const len = freqData.length;
  const avg = (a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += freqData[i];
    return s / ((b - a) * 255);
  };
  audioBands[0] = avg(0,                      Math.floor(len * 0.10)); // bass
  audioBands[1] = avg(Math.floor(len * 0.10), Math.floor(len * 0.50)); // mid
  audioBands[2] = avg(Math.floor(len * 0.50), len);                    // treble
}

// ─── Phase-3 reset ────────────────────────────────────────────────────────────
function resetToPhase1() {
  phase      = Phase.P1;
  rightTimer = 0;
  mouseEnergy = 0;
  mouseSilent = 999;

  // Re-upload cached initial positions to ping buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, ping.vbo_p);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, initData.pos);
  gl.bindBuffer(gl.ARRAY_BUFFER, ping.vbo_v);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, initData.vel);
  gl.bindBuffer(gl.ARRAY_BUFFER, ping.vbo_d);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, initData.pd);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

// ─── p5 preload ───────────────────────────────────────────────────────────────
function preload() {
  sh = loadShader('vert.glsl', 'frag.glsl');
}

// ─── p5 setup ─────────────────────────────────────────────────────────────────
function setup() {
  W = windowWidth;
  H = windowHeight;
  const canv = createCanvas(W, H, WEBGL);
  gl.viewport(0, 0, W, H);
  canv._viewport = gl.getParameter(gl.VIEWPORT);
  pixelDensity(1);

  document.addEventListener('contextmenu', e => e.preventDefault());

  // Build initial particle data (cached for Phase-3 reset)
  initData = makeParticleData(N_MAX);

  ping = makeBuf(initData.pos, initData.vel, initData.pd);
  // pong gets same-sized (but throwaway) initial data; TF overwrites it on frame 1
  const blank = makeParticleData(N_MAX);
  pong = makeBuf(blank.pos, blank.vel, blank.pd);

  // Inject Transform Feedback varyings before shader link
  // (khlorghaal's linkProgram getter hack — runs exactly once)
  const hax = gl.linkProgram;
  Object.defineProperty(gl, 'linkProgram', {
    get: (function () {
      gl.transformFeedbackVaryings(
        (() => sh._glProgram)(),
        ['v_p3', 'v_v3', 'v_pd'],
        gl.SEPARATE_ATTRIBS
      );
      gl.linkProgram = hax;
      return hax;
    })
  });
  shader(sh);
  rect(0, 0, 0, 0);   // force shader compilation

  const err = gl.getError();
  if (err) console.error('WebGL setup error:', err);

  initAudio();
}

// ─── p5 draw ──────────────────────────────────────────────────────────────────
function draw() {
  const dt = Math.min(deltaTime / 1000, 0.05); // seconds, clamped

  // ── LOD
  const n = Math.floor(lod(dt) * N_MAX / 2) * 2; // keep even (2 wings)

  // ── Mouse state
  mouseSilent++;
  if (mouseSilent > 8) mouseEnergy = Math.max(0, mouseEnergy - dt * 0.8);

  // ── Phase transitions
  const rightHeld = mouseIsPressed && mouseButton === RIGHT;
  if (rightHeld) {
    rightTimer += dt;
    if (rightTimer >= 1.5 && phase !== Phase.P1) resetToPhase1();
  } else {
    rightTimer = 0;
  }

  const transTarget = phase === Phase.P1 ? 0.0 : 1.0;
  transition += (transTarget - transition) * Math.min(1, dt * 1.8);

  // ── Auto-rotation
  autoRotY += dt * 0.22;   // radians/sec — one full spin ~28 seconds

  const mNX = (mouseX / W * 2 - 1) * (W / H);   // aspect-corrected NDC
  const mNY = (1 - mouseY / H) * 2 - 1;

  rotY = autoRotY + mNX * transition * 0.28;
  rotX = 0.30 + mNY * transition * 0.14;

  // ── Pull factor for Phase-3 Eternal Return
  const pull = (rightTimer > 0.4 && phase !== Phase.P1)
    ? Math.min(1, (rightTimer - 0.4) * 1.2)
    : 0;

  // ── Audio
  updateAudio();

  // ── GL render state
  gl.clearColor(0.04, 0.015, 0.07, 1.0);   // deep dark violet-black
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);   // additive glow blending

  // ── Shader uniforms
  shader(sh);
  sh.setUniform('u_time',       millis() * 0.001);
  sh.setUniform('u_rot',        rotMat3(rotX, rotY));
  sh.setUniform('u_mouse',      [mNX, mNY]);
  sh.setUniform('u_transition', transition);
  sh.setUniform('u_energy',     mouseEnergy);
  sh.setUniform('u_audio',      audioBands);
  sh.setUniform('u_asp',        H / W);
  sh.setUniform('u_pull',       pull);
  sh.setUniform('u_left_btn',   (mouseIsPressed && mouseButton === LEFT) ? 1 : 0);

  // ── GPU simulation + draw (one call — physics & rendering together)
  gl.bindVertexArray(ping.vao);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, pong.xfb);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.endTransformFeedback();
  gl.bindVertexArray(null);

  pingpong();
}

// ─── Input events ─────────────────────────────────────────────────────────────
function mouseMoved() {
  if (phase === Phase.P1) phase = Phase.P2;
  mouseSilent = 0;
  mouseEnergy = Math.min(1.0, mouseEnergy + 0.25);
}

function mouseDragged() {
  mouseSilent = 0;
  mouseEnergy = Math.min(1.0, mouseEnergy + 0.15);
}

function windowResized() {
  W = windowWidth;
  H = windowHeight;
  resizeCanvas(W, H);
  gl.viewport(0, 0, W, H);
}
