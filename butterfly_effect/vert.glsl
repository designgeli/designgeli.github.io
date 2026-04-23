#version 300 es
precision highp float;

// ─── Tuning constants ─────────────────────────────────────────────────────────
const float WING_X     = 26.0;
const float L_ZCENTER  = 25.0;
const float SCENE_SCALE= 0.0155;
const float FOV_DEPTH  = 0.006;
const float DT         = 0.009;
const float BIGNESS    = 1.3;

const float L_SIGMA = 10.0;
const float L_RHO   = 28.0;
const float L_BETA  = 2.6667;

// Phase-2 overlay interaction
const float WAVE_K   = 22.0;
const float WAVE_SPD = 5.0;
const float WAVE_DEC = 4.5;

// ─── Utilities ────────────────────────────────────────────────────────────────
#define len  length
#define lerp mix
#define norm normalize

vec3 nse_3_3(vec3 v) {
  uvec3 x = uvec3(v * 4321.0);
  const uint k = 1103515245U;
  x = ((x >> 8U) ^ x.yzx) * k;
  x = ((x >> 8U) ^ x.yzx) * k;
  return vec3(x) * (2.0 / float(0xffffffffU)) - 1.0;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * lerp(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// ─── Lorenz system ────────────────────────────────────────────────────────────
vec3 lorenz_f(vec3 p) {
  return vec3(
    L_SIGMA * (p.y - p.x),
    p.x * (L_RHO - p.z) - p.y,
    p.x * p.y - L_BETA * p.z
  );
}

vec3 lorenz_rk4(vec3 p, float dt) {
  vec3 k1 = lorenz_f(p);
  vec3 k2 = lorenz_f(p + 0.5*dt*k1);
  vec3 k3 = lorenz_f(p + 0.5*dt*k2);
  vec3 k4 = lorenz_f(p + dt*k3);
  return p + (dt / 6.0) * (k1 + 2.0*k2 + 2.0*k3 + k4);
}

// ─── Uniforms ─────────────────────────────────────────────────────────────────
uniform float u_time;
uniform mat3  u_rot;
uniform float u_asp;
uniform float u_zoom;
uniform float u_transition;   // 0=Phase1, 1=Phase2

// Phase-2 mode
uniform int   u_mode;         // current mode 1–5
uniform int   u_prev_mode;    // previous mode (for crossfade)
uniform float u_mode_blend;   // 0=prev, 1=current

// Overlay forces
uniform vec2  u_mouse;        // NDC cursor position
uniform float u_energy;       // ripple energy [0,1]
uniform int   u_left_drag;    // left held + moved → Mouse Ripple
uniform int   u_right_btn;    // right held → Explosive Repulsion
uniform int   u_mid_btn;      // middle held → Gravitational Vortex

// Legacy / future
uniform vec3  u_audio;
uniform float u_pull;
uniform float u_pt_size;

// ─── Vertex I/O ───────────────────────────────────────────────────────────────
layout(location=0) in vec3 in_p3;
layout(location=1) in vec3 in_v3;
layout(location=2) in vec2 in_pd;  // [wing_id, seed]

out vec3      v_p3;
out vec3      v_v3;
out vec2      v_pd;
flat out vec4 v_c;

// ─── Phase-2 mode force functions ─────────────────────────────────────────────

// Mode 1 — Drift: slow organic noise-field wandering
vec3 force_drift(vec3 p, float seed) {
  vec3 a = nse_3_3(p * 0.025 + vec3(seed * 0.3, 0.0, u_time * 0.09)) * 0.022;
  vec3 b = nse_3_3(p * 0.012 + vec3(0.0, seed * 0.5, u_time * 0.05)) * 0.012;
  return a + b;
}

// Mode 2 — Vortex: each wing orbits around its own attractor saddle
vec3 force_vortex(vec3 p, float wing_sign) {
  vec3 center = vec3(wing_sign * 8.0, wing_sign * 8.0, 27.0);
  vec3 rel    = p - center;
  // tangential force in XZ plane around Y axis
  vec3 tang   = cross(rel, vec3(0.3, 1.0, 0.2));
  float d     = max(1.0, len(rel));
  return norm(tang + vec3(0.001)) * 0.0040 * min(d * 0.04, 1.0);
}

// Mode 3 — Pulse: radial breathing from each wing's saddle point
vec3 force_pulse(vec3 p, float wing_sign) {
  vec3 center = vec3(wing_sign * 8.0, wing_sign * 8.0, 27.0);
  vec3 dir    = p - center;
  float pulse = sin(u_time * 1.6) * 0.018;
  return norm(dir + vec3(0.001)) * pulse;
}

// Mode 4 — Gravity Well: 3 Lissajous-orbit attractors
vec3 force_gravity_well(vec3 p) {
  float t  = u_time * 0.35;
  vec3  f  = vec3(0.0);

  vec3 w0 = vec3(sin(t)         * 15.0, cos(t * 1.3) * 15.0, 20.0 + sin(t * 0.7) * 8.0);
  vec3 w1 = vec3(sin(t*1.7+2.1) * 18.0, cos(t * 0.9) * 12.0, 30.0 + cos(t * 1.1) * 6.0);
  vec3 w2 = vec3(cos(t*0.8+1.0) * 12.0, sin(t * 1.5) * 18.0, 15.0 + cos(t * 1.2) * 8.0);

  vec3 d0 = w0 - p; f += d0 * 0.0018 / (dot(d0,d0) + 5.0);
  vec3 d1 = w1 - p; f += d1 * 0.0018 / (dot(d1,d1) + 5.0);
  vec3 d2 = w2 - p; f += d2 * 0.0018 / (dot(d2,d2) + 5.0);
  return f;
}

// Mode 5 — Wave Field: sinusoidal standing-wave force
vec3 force_wave(vec3 p) {
  float wx = sin(p.z * 0.18 + u_time * 1.20) * 0.014;
  float wy = cos(p.x * 0.14 + u_time * 0.90) * 0.014;
  float wz = sin(p.y * 0.16 + u_time * 1.50) * 0.009;
  return vec3(wx, wy, wz);
}

vec3 modeForce(int m, vec3 p, vec3 v, float seed, float wing_sign) {
  if (m == 1) return force_drift(p, seed);
  if (m == 2) return force_vortex(p, wing_sign);
  if (m == 3) return force_pulse(p, wing_sign);
  if (m == 4) return force_gravity_well(p);
  if (m == 5) return force_wave(p);
  return vec3(0.0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
void main() {
  vec3  p    = in_p3;
  vec3  v    = in_v3;
  float wing = in_pd.x;
  float seed = in_pd.y;

  float wing_sign   = wing < 0.5 ? -1.0 : 1.0;
  vec3  wing_center = vec3(wing_sign * WING_X, 0.0, -L_ZCENTER);
  vec3  world_p     = p + wing_center;

  // ── Phase-1: RK4 Lorenz ────────────────────────────────────────────────────
  vec3 lorenz_p = lorenz_rk4(p, DT);
  vec3 lorenz_v = lorenz_p - p;

  // Nudge stalled particle away from trivial fixed-point
  if (len(p) < 0.5) {
    lorenz_p = vec3(1.0, 1.0, 25.0)
             + nse_3_3(vec3(seed, u_time, wing)) * 3.0;
    lorenz_v = vec3(0.0);
  }

  // ── Screen position for overlay interaction ────────────────────────────────
  vec3  rp    = u_rot * world_p;
  float persp = max(0.1, 1.0 + rp.z * FOV_DEPTH);
  vec2  sp    = vec2(rp.x * u_asp, rp.y) * SCENE_SCALE * u_zoom / persp;

  vec2  delta = sp - u_mouse;
  float dist  = max(0.003, len(delta));

  // ── Phase-2: mode force (blended crossfade) ────────────────────────────────
  vec3 mf_cur  = modeForce(u_mode,      p, v, seed, wing_sign);
  vec3 mf_prev = modeForce(u_prev_mode, p, v, seed, wing_sign);
  vec3 mode_f  = lerp(mf_prev, mf_cur, u_mode_blend);

  // Ambient drift (always active in Phase 2, keeps particles alive)
  vec3 ambient = nse_3_3(p * 0.035 + vec3(seed, seed * 0.7, u_time * 0.12)) * 0.010;

  // ── Overlay forces ─────────────────────────────────────────────────────────
  vec2 overlay = vec2(0.0);

  // Left drag → Mouse Ripple traveling wave
  if (u_left_drag != 0) {
    float wave = sin(dist * WAVE_K - u_time * WAVE_SPD) * exp(-dist * WAVE_DEC);
    overlay   += norm(delta) * wave * u_energy * 0.0055;
  }

  // Right button → Explosive Repulsion
  if (u_right_btn != 0) {
    float r2  = dist * dist + 0.004;
    overlay  += norm(delta) * 0.022 / r2;
  }

  // Middle button → Gravitational Vortex
  if (u_mid_btn != 0) {
    float r2   = dist * dist + 0.006;
    vec2  pull  = -norm(delta)            * 0.016 / r2;
    vec2  swirl =  vec2(-delta.y, delta.x) * 0.008 / (dist + 0.05);
    overlay += pull + swirl;
  }

  // De-project screen-space overlay → approximate 3D force
  vec3 mouse_force = vec3(
    overlay.x / (SCENE_SCALE * u_asp),
    overlay.y / SCENE_SCALE,
    0.0
  );

  // Audio (inactive for now, zero uniforms)
  float bass_scale  = 1.0 + u_audio.x * 0.55;
  vec3  curl_force  = vec3(-v.y, v.x, 0.0) * u_audio.y * 0.0045;
  vec3  noise       = nse_3_3(p * 0.07 + vec3(0.0, 0.0, u_time * 0.4));
  vec3  treble_jitter = noise * u_audio.z * 0.022;

  vec3 free_v = v * 0.985 * bass_scale
              + mode_f + mouse_force + curl_force + treble_jitter + ambient;
  vec3 free_p = p + free_v;

  // ── Blend Phase 1 ↔ Phase 2 ────────────────────────────────────────────────
  float t     = u_transition;
  vec3  new_p = lerp(lorenz_p, free_p,  t);
  vec3  new_v = lerp(lorenz_v, free_v,  t);

  // ── Boundary ───────────────────────────────────────────────────────────────
  // Phase-1: tight Lorenz basin
  if (t < 0.5) {
    if (abs(p.x) > 52.0 || abs(p.y) > 65.0 || p.z < -8.0 || p.z > 62.0) {
      vec3 kick = nse_3_3(vec3(seed * 5.1, u_time * 0.07, wing)) * 4.0;
      new_p = vec3(wing_sign * 8.0, wing_sign * 8.0, 27.0) + kick;
      new_v = vec3(0.0);
    }
  } else {
    // Phase-2: large soft boundary; reset escaped particles near origin
    if (abs(new_p.x) > 140.0 || abs(new_p.y) > 140.0 || abs(new_p.z - 25.0) > 120.0) {
      vec3 kick = nse_3_3(vec3(seed * 3.7, u_time * 0.05, wing)) * 8.0;
      new_p = vec3(0.0, 0.0, 25.0) + kick;
      new_v = vec3(0.0);
    }
  }

  // ── Phase-3 basin pull (future use) ────────────────────────────────────────
  if (u_pull > 0.001) {
    vec3 basin = vec3(wing_sign * 8.0, wing_sign * 8.0, 27.0);
    new_p = lerp(new_p, basin, u_pull * 0.045);
    new_v *= (1.0 - u_pull * 0.18);
  }

  // ── Transform Feedback output ──────────────────────────────────────────────
  v_p3 = new_p;
  v_v3 = new_v;
  v_pd = in_pd;

  // ── Projection ─────────────────────────────────────────────────────────────
  vec3  new_world = new_p + wing_center;
  vec3  new_rp    = u_rot * new_world;
  float new_persp = max(0.1, 1.0 + new_rp.z * FOV_DEPTH);
  vec2  new_sp    = vec2(new_rp.x * u_asp, new_rp.y) * SCENE_SCALE * u_zoom / new_persp;

  gl_Position  = vec4(new_sp, 0.0, 1.0);
  gl_PointSize = BIGNESS * u_pt_size;

  // ── Color ──────────────────────────────────────────────────────────────────

  // Phase-1: position-based, always bright
  float z_norm = clamp(new_p.z / 48.0, 0.0, 1.0);
  float x_norm = clamp((new_p.x + 20.0) / 40.0, 0.0, 1.0);
  float h1     = fract(z_norm * 0.70 + x_norm * 0.30 + wing * 0.16 + seed * 0.06);
  float v1     = 0.60 + 0.40 * z_norm;
  vec3  col1   = hsv2rgb(vec3(h1, 0.90, v1));

  // Phase-2: velocity hue + position hue blend + per-mode hue tint
  float spd2      = len(v);
  float pos_hue2  = fract(p.x * 0.018 + p.z * 0.012 + u_time * 0.025 + wing * 0.16 + seed * 0.08);
  float vel_hue2  = fract(sqrt(spd2 * 9.0) * 1.6 + wing * 0.16);
  float vel_wt    = smoothstep(0.0, 0.06, spd2);
  float mouse_glow= 1.0 - smoothstep(0.0, 0.22, dist);

  // Per-mode hue tint: mode 0 = neutral; modes 1–5 → 0.0, 0.20, 0.40, 0.60, 0.80
  float cur_tint  = float(max(u_mode,      1) - 1) * 0.20;
  float prv_tint  = float(max(u_prev_mode, 1) - 1) * 0.20;
  float mode_tint = lerp(prv_tint, cur_tint, u_mode_blend) * 0.35;

  float h2      = fract(lerp(pos_hue2, vel_hue2, vel_wt) + mouse_glow * 0.08 + mode_tint);
  float v2      = clamp(0.60 + 0.40 * vel_wt + mouse_glow * 0.40, 0.0, 1.0);
  vec3  col2    = hsv2rgb(vec3(h2, 0.95, v2));

  vec3  final_col = lerp(col1, col2, t);
  float ev        = lerp(0.40, 0.30, t);

  float sparkle = 1.0 + u_audio.z * abs(noise.x) * 1.6;
  final_col    *= sparkle;

  v_c = vec4(final_col, ev);
}
