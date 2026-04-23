/*
  蝴蝶效應 — Butterfly Effect
  Mode 0 : 比翼雙飛 — Lorenz attractor (Phase 1)
  Mode 1–5: 轉瞬浮光 — Ephemeral Glimpse (Phase 2)

  Cycle: 0→1→2→3→4→5→0→1→…
  Manual : click/tap → advance one step
  Auto   : 30 s idle → advance one step

  Mouse controls:
    Left click (release)   → advance mode
    Left drag              → Mouse Ripple
    Right hold             → Explosive Repulsion
    Middle hold            → Gravitational Vortex
    Scroll wheel           → Zoom
    M key                  → Mute toggle

  Touch controls:
    1-finger tap           → advance mode
    1-finger drag          → Mouse Ripple
    2-finger pinch/spread  → Zoom
    2-finger drag          → Explosive Repulsion
    3-finger tap           → Mute toggle
*/

const N_MAX   = 600_000;
const N_MODES = 6;

const MODE_NAMES = [
  'Mode 0  比翼雙飛',
  'Mode 1  Drift 漂流',
  'Mode 2  Vortex 漩渦',
  'Mode 3  Pulse 脈衝',
  'Mode 4  Gravity Well 引力井',
  'Mode 5  Wave Field 波場',
];

let musicStarted   = false;
let firstClickDone = false;   // first tap/click starts music; second advances mode

// ─── Mode state ───────────────────────────────────────────────────────────────
let mode       = 0;
let prevMode   = 0;
let modeBlend  = 1.0;
let transition = 0.0;

const BLEND_DUR = 0.8;
const TRANS_DUR = 0.8;
const AUTO_MS   = 30_000;
let lastAdvanceTime = 0;

// ─── Input state ──────────────────────────────────────────────────────────────
let leftDown  = false;
let leftMoved = false;
let rightDown = false;
let midDown   = false;

// ─── Mouse ────────────────────────────────────────────────────────────────────
let mouseNDC  = [0, 0];
let energy    = 0.0;
let prevMX    = 0, prevMY = 0;

// ─── Touch ────────────────────────────────────────────────────────────────────
let touchActive    = false;
let prevTouchX     = 0, prevTouchY = 0;
let touchStartDist = 0;
let maxTouchCount  = 0;   // peak simultaneous fingers in this gesture sequence
let touchMoved     = false;

// ─── Camera ───────────────────────────────────────────────────────────────────
let autoRotY = 0.0;
let rotX     = 0.25;
let zoom     = 1.0;

const audioBands = [0, 0, 0];

// ─── WebGL handles ────────────────────────────────────────────────────────────
let gl, W, H, sh;
let ping, pong;

// ─── p5 WebGL2 context override ───────────────────────────────────────────────
p5.RendererGL.prototype._initContext = function () {
  this.drawingContext = this.canvas.getContext('webgl2', this._pInst._glAttributes);
  if (!this.drawingContext) alert('WebGL2 not available.');
  gl = this.drawingContext;
};

// ─── CPU Lorenz RK4 (warm-start) ──────────────────────────────────────────────
function lorenzStep([x, y, z], dt) {
  const f = (x, y, z) => [10*(y-x), x*(28-z)-y, x*y - (8/3)*z];
  const [k1x,k1y,k1z] = f(x, y, z);
  const [k2x,k2y,k2z] = f(x+.5*dt*k1x, y+.5*dt*k1y, z+.5*dt*k1z);
  const [k3x,k3y,k3z] = f(x+.5*dt*k2x, y+.5*dt*k2y, z+.5*dt*k2z);
  const [k4x,k4y,k4z] = f(x+dt*k3x,    y+dt*k3y,    z+dt*k3z);
  return [
    x + dt/6*(k1x+2*k2x+2*k3x+k4x),
    y + dt/6*(k1y+2*k2y+2*k3y+k4y),
    z + dt/6*(k1z+2*k2z+2*k3z+k4z)
  ];
}

function makeAttractorData(n) {
  const DT = 0.007, WARMUP = 4000, STRIDE = 5;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const pd  = new Float32Array(n * 2);

  let pA = [0.1,  0.1, 25.0];
  let pB = [-0.1, 0.1, 25.0];
  for (let i = 0; i < WARMUP; i++) { pA = lorenzStep(pA, DT); pB = lorenzStep(pB, DT); }

  const halfN = Math.floor(n / 2);
  for (let i = 0; i < halfN; i++) {
    for (let s = 0; s < STRIDE; s++) pA = lorenzStep(pA, DT);
    for (let s = 0; s < STRIDE; s++) pB = lorenzStep(pB, DT);
    const iA = 2*i, iB = 2*i+1;
    pos[iA*3]   = pA[0]; pos[iA*3+1] = pA[1]; pos[iA*3+2] = pA[2];
    pos[iB*3]   = pB[0]; pos[iB*3+1] = pB[1]; pos[iB*3+2] = pB[2];
    pd[iA*2]    = 0; pd[iA*2+1] = Math.random();
    pd[iB*2]    = 1; pd[iB*2+1] = Math.random();
  }
  return { pos, vel, pd };
}

// ─── GPU buffer pair ──────────────────────────────────────────────────────────
function makeBuf(pos, vel, pd) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const mkVbo = (data, loc, sz) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 0, 0);
    return b;
  };
  const vbo_p = mkVbo(pos, 0, 3);
  const vbo_v = mkVbo(vel, 1, 3);
  const vbo_d = mkVbo(pd,  2, 2);

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

// ─── Mode / HUD helpers ───────────────────────────────────────────────────────
function advanceMode() {
  prevMode        = mode;
  mode            = (mode + 1) % N_MODES;
  modeBlend       = 0.0;
  lastAdvanceTime = millis();
  setMusicMode(mode);
  updateHUD();
  console.log('Mode →', mode);
}

function updateHUD() {
  const elMode = document.getElementById('hud-mode');
  if (elMode) elMode.textContent = MODE_NAMES[mode];

  const elHint = document.getElementById('hud-hint');
  if (elHint) {
    elHint.textContent = ('ontouchstart' in window)
      ? 'tap · drag · pinch · 3-tap = mute'
      : 'click · drag · scroll · M = mute';
  }
}

function triggerMute() {
  const muted = toggleMute();
  const el = document.getElementById('hud-mute');
  if (el) el.style.display = muted ? 'inline' : 'none';
}

function handleFirstInteraction() {
  if (!musicStarted) { startMusic(mode); musicStarted = true; }
}

function handleTap() {
  if (!firstClickDone) {
    firstClickDone = true;  // first tap: music already started, stay at Mode 0
  } else {
    advanceMode();
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function rotMat3(rx, ry) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  return [cy, sx*sy, -cx*sy, 0, cx, sx, sy, -sx*cy, cx*cy];
}

function toNDC(mx, my) {
  return [(mx / W) * 2 - 1, 1 - (my / H) * 2];
}

function touchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

function touchMid(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

// ─── p5 preload ───────────────────────────────────────────────────────────────
function preload() {
  sh = loadShader('vert.glsl', 'frag.glsl');
}

// ─── p5 setup ─────────────────────────────────────────────────────────────────
function setup() {
  W = windowWidth; H = windowHeight;
  const canv = createCanvas(W, H, WEBGL);
  gl.viewport(0, 0, W, H);
  canv._viewport = gl.getParameter(gl.VIEWPORT);
  pixelDensity(1);

  document.addEventListener('contextmenu', e => e.preventDefault());

  // ── Mouse events ──────────────────────────────────────────────────────────
  document.addEventListener('mousedown', e => {
    handleFirstInteraction();
    if (e.button === 0) { leftDown = true; leftMoved = false; }
    if (e.button === 1) { midDown  = true; e.preventDefault(); }
    if (e.button === 2) { rightDown = true; }
  });

  document.addEventListener('mouseup', e => {
    if (e.button === 0) {
      if (!leftMoved) handleTap();
      leftDown = false;
    }
    if (e.button === 1) midDown   = false;
    if (e.button === 2) rightDown = false;
  });

  document.addEventListener('mousemove', () => {
    if (leftDown) leftMoved = true;
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'm' || e.key === 'M') triggerMute();
  });

  // ── Touch events ──────────────────────────────────────────────────────────
  document.addEventListener('touchstart', e => {
    e.preventDefault();
    handleFirstInteraction();

    touchMoved = false;
    maxTouchCount = Math.max(maxTouchCount, e.touches.length);
    touchActive = true;

    const n = e.touches.length;

    if (n === 1) {
      const t = e.touches[0];
      prevTouchX = t.clientX;
      prevTouchY = t.clientY;
      mouseNDC   = toNDC(t.clientX, t.clientY);
      leftDown   = true;
      leftMoved  = false;
      rightDown  = false;
      midDown    = false;
    } else if (n === 2) {
      // Switch from single-finger to two-finger: stop ripple, start repulsion
      leftDown       = false;
      leftMoved      = false;
      rightDown      = true;
      touchStartDist = touchDist(e.touches[0], e.touches[1]);
      const mp = touchMid(e.touches[0], e.touches[1]);
      mouseNDC = toNDC(mp.x, mp.y);
    } else if (n >= 3) {
      // Three or more fingers: cancel all force effects, prepare for mute tap
      leftDown  = false;
      rightDown = false;
      midDown   = false;
    }
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    e.preventDefault();
    touchMoved    = true;
    maxTouchCount = Math.max(maxTouchCount, e.touches.length);
    const n = e.touches.length;

    if (n === 1 && leftDown) {
      const t = e.touches[0];
      mouseNDC  = toNDC(t.clientX, t.clientY);
      leftMoved = true;
      const dx  = t.clientX - prevTouchX;
      const dy  = t.clientY - prevTouchY;
      energy    = Math.min(1.0, energy + Math.sqrt(dx*dx + dy*dy) * 0.006);
      prevTouchX = t.clientX;
      prevTouchY = t.clientY;
    } else if (n === 2) {
      // Pinch zoom
      const newDist = touchDist(e.touches[0], e.touches[1]);
      if (touchStartDist > 0) {
        zoom = Math.max(0.2, Math.min(5.0, zoom * (newDist / touchStartDist)));
      }
      touchStartDist = newDist;
      // Repulsion follows the midpoint
      const mp = touchMid(e.touches[0], e.touches[1]);
      mouseNDC = toNDC(mp.x, mp.y);
    }
  }, { passive: false });

  document.addEventListener('touchend', e => {
    e.preventDefault();
    const remaining = e.touches.length;
    touchActive = remaining > 0;

    if (remaining === 0) {
      // All fingers lifted — evaluate the completed gesture
      if (!touchMoved) {
        if (maxTouchCount >= 3) {
          triggerMute();
        } else if (maxTouchCount === 1) {
          handleTap();
        }
      }
      // Reset all input state
      leftDown  = false;
      leftMoved = false;
      rightDown = false;
      midDown   = false;
      maxTouchCount = 0;
      touchMoved    = false;
    } else if (remaining === 1) {
      // Went from 2-finger to 1-finger: stop repulsion, resume single-finger drag
      rightDown = false;
      const t = e.touches[0];
      prevTouchX = t.clientX;
      prevTouchY = t.clientY;
      mouseNDC   = toNDC(t.clientX, t.clientY);
      leftDown   = true;
      leftMoved  = false;
    }
  }, { passive: false });

  document.addEventListener('touchcancel', e => {
    touchActive   = false;
    leftDown      = false;
    leftMoved     = false;
    rightDown     = false;
    midDown       = false;
    maxTouchCount = 0;
    touchMoved    = false;
  }, { passive: false });

  // ── GPU init ──────────────────────────────────────────────────────────────
  console.log('Building attractor warm-start…');
  const data = makeAttractorData(N_MAX);
  console.log('Done. Uploading to GPU…');

  ping = makeBuf(data.pos, data.vel, data.pd);
  pong = makeBuf(data.pos, data.vel, data.pd);

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
  rect(0, 0, 0, 0);

  lastAdvanceTime = millis();
  updateHUD();
  const err = gl.getError();
  if (err) console.error('WebGL error:', err);
}

// ─── p5 draw ──────────────────────────────────────────────────────────────────
function draw() {
  const dt = Math.min(deltaTime / 1000, 0.05);
  const n  = Math.floor(lod(dt) * N_MAX / 2) * 2;

  autoRotY += dt * 0.20;

  if (millis() - lastAdvanceTime > AUTO_MS) advanceMode();

  // Phase transition ramp
  const targetTrans = (mode === 0) ? 0.0 : 1.0;
  if (transition < targetTrans) transition = Math.min(targetTrans, transition + dt / TRANS_DUR);
  if (transition > targetTrans) transition = Math.max(targetTrans, transition - dt / TRANS_DUR);

  // Mode crossfade ramp
  if (modeBlend < 1.0) modeBlend = Math.min(1.0, modeBlend + dt / BLEND_DUR);

  // Energy: mouse builds in draw(); touch builds in touchmove handler
  if (!touchActive) {
    const dmx = mouseX - prevMX;
    const dmy = mouseY - prevMY;
    if (leftDown && leftMoved) {
      energy = Math.min(1.0, energy + Math.sqrt(dmx*dmx + dmy*dmy) * 0.008);
    } else {
      energy = Math.max(0.0, energy - dt * 2.5);
    }
    prevMX   = mouseX;
    prevMY   = mouseY;
    mouseNDC = toNDC(mouseX, mouseY);
  } else {
    // Touch: energy decay when no active drag
    if (!(leftDown && leftMoved)) {
      energy = Math.max(0.0, energy - dt * 2.5);
    }
  }

  // ── Render ──
  gl.clearColor(0.03, 0.01, 0.06, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  shader(sh);
  sh.setUniform('u_time',       millis() * 0.001);
  sh.setUniform('u_rot',        rotMat3(rotX, autoRotY));
  sh.setUniform('u_asp',        H / W);
  sh.setUniform('u_zoom',       zoom);
  sh.setUniform('u_transition', transition);
  sh.setUniform('u_mode',       mode);
  sh.setUniform('u_prev_mode',  prevMode);
  sh.setUniform('u_mode_blend', modeBlend);
  sh.setUniform('u_mouse',      mouseNDC);
  sh.setUniform('u_energy',     energy);
  sh.setUniform('u_left_drag',  (leftDown && leftMoved) ? 1 : 0);
  sh.setUniform('u_right_btn',  rightDown ? 1 : 0);
  sh.setUniform('u_mid_btn',    midDown   ? 1 : 0);
  sh.setUniform('u_audio',      audioBands);
  sh.setUniform('u_pull',       0.0);
  sh.setUniform('u_pt_size',    1.0);

  gl.bindVertexArray(ping.vao);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, pong.xfb);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.endTransformFeedback();
  gl.bindVertexArray(null);

  pingpong();
}

// ─── Scroll zoom ──────────────────────────────────────────────────────────────
function mouseWheel(event) {
  zoom *= 1 - event.delta * 0.001;
  zoom = Math.max(0.2, Math.min(5.0, zoom));
  return false;
}

function windowResized() {
  W = windowWidth; H = windowHeight;
  resizeCanvas(W, H);
  gl.viewport(0, 0, W, H);
}
