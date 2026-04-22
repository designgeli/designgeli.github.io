#version 300 es
precision highp float;

// ─── Tuning constants ─────────────────────────────────────────────────────────
const float WING_X     = 26.0;   // world-space X offset between the two wings
const float L_ZCENTER  = 25.0;   // re-center Lorenz z[0,50] around 0
const float SCENE_SCALE= 0.0155; // world units → NDC
const float FOV_DEPTH  = 0.006;  // weak perspective strength
const float DT         = 0.009;  // Lorenz integration step
const float BIGNESS    = 1.3;    // point size (pixels)

// Lorenz parameters — ρ=28 is the classic chaos onset point
const float L_SIGMA = 10.0;
const float L_RHO   = 28.0;
const float L_BETA  = 2.6667;   // 8/3

// Phase-2 interaction
const float WAVE_K   = 22.0;    // spatial ripple frequency
const float WAVE_SPD = 5.0;     // ripple propagation speed
const float WAVE_DEC = 4.5;     // distance decay

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

// RK4 keeps Phase-1 locked to the attractor manifold (no error drift)
vec3 lorenz_rk4(vec3 p, float dt) {
  vec3 k1 = lorenz_f(p);
  vec3 k2 = lorenz_f(p + 0.5*dt*k1);
  vec3 k3 = lorenz_f(p + 0.5*dt*k2);
  vec3 k4 = lorenz_f(p + dt*k3);
  return p + (dt / 6.0) * (k1 + 2.0*k2 + 2.0*k3 + k4);
}

// ─── Uniforms ─────────────────────────────────────────────────────────────────
uniform float u_time;       // seconds
uniform mat3  u_rot;        // world rotation (column-major Rx*Ry)
uniform vec2  u_mouse;      // NDC with aspect correction
uniform float u_transition; // 0 = Phase1, 1 = Phase2
uniform float u_energy;     // mouse energy [0,1]
uniform vec3  u_audio;      // [bass, mid, treble] each [0,1]
uniform float u_asp;        // H/W
uniform float u_pull;       // Phase3 basin pull factor [0,1]
uniform int   u_left_btn;   // left mouse button state

// ─── Vertex I/O ───────────────────────────────────────────────────────────────
layout(location=0) in vec3 in_p3;  // local Lorenz 3D position
layout(location=1) in vec3 in_v3;  // velocity (displacement per frame)
layout(location=2) in vec2 in_pd;  // [wing_id (0/1), random seed]

out vec3     v_p3;
out vec3     v_v3;
out vec2     v_pd;
flat out vec4 v_c;

// ─── Main ─────────────────────────────────────────────────────────────────────
void main() {
  vec3  p    = in_p3;
  vec3  v    = in_v3;
  float wing = in_pd.x;  // 0 = left, 1 = right
  float seed = in_pd.y;

  float wing_sign   = wing < 0.5 ? -1.0 : 1.0;
  vec3  wing_center = vec3(wing_sign * WING_X, 0.0, -L_ZCENTER);
  vec3  world_p     = p + wing_center;

  // ── Phase-1: RK4 Lorenz (deterministic attractor orbit) ──────────────────
  vec3 lorenz_p = lorenz_rk4(p, DT);
  vec3 lorenz_v = lorenz_p - p;

  // Nudge any stalled particle away from the trivial fixed-point at origin
  if (len(p) < 0.5) {
    lorenz_p = vec3(1.0, 1.0, 25.0)
             + nse_3_3(vec3(seed, u_time, wing)) * 3.0;
    lorenz_v = vec3(0.0);
  }

  // ── Screen position (used for Phase-2 mouse interaction) ─────────────────
  vec3  rp     = u_rot * world_p;
  float persp  = max(0.1, 1.0 + rp.z * FOV_DEPTH);
  vec2  sp     = vec2(rp.x * u_asp, rp.y) * SCENE_SCALE / persp;

  // ── Phase-2: free flight with mouse ripples ───────────────────────────────
  vec2  delta    = sp - u_mouse;
  float dist     = max(0.003, len(delta));

  // Traveling wave from cursor
  float wave     = sin(dist * WAVE_K - u_time * WAVE_SPD)
                 * exp(-dist * WAVE_DEC);
  vec2  ripple   = norm(delta) * wave * u_energy * 0.0055;

  // Left-click: explosive repulsion burst
  if (u_left_btn != 0) {
    float r2  = dist * dist + 0.004;
    ripple   += norm(delta) * u_energy * 0.018 / r2;
  }

  // De-project screen-space force → approximate 3D world-space force
  vec3  mouse_force = vec3(
    ripple.x / (SCENE_SCALE * u_asp),
    ripple.y / SCENE_SCALE,
    0.0
  );

  // Audio forces
  vec3  noise   = nse_3_3(p * 0.07 + vec3(0.0, 0.0, u_time * 0.4));
  float bass    = u_audio.x;
  float mid     = u_audio.y;
  float treble  = u_audio.z;

  float bass_scale    = 1.0 + bass * 0.55;            // pulsate magnitude
  vec3  curl_force    = vec3(-v.y, v.x, 0.0) * mid * 0.0045; // swirl
  vec3  treble_jitter = noise * treble * 0.022;

  vec3  free_v = v * 0.977 * bass_scale
               + mouse_force + curl_force + treble_jitter;
  vec3  free_p = p + free_v;

  // ── Blend phases ──────────────────────────────────────────────────────────
  float t     = u_transition;
  vec3  new_p = lerp(lorenz_p, free_p,  t);
  vec3  new_v = lerp(lorenz_v, free_v,  t);

  // ── Boundary: pull back if too far ───────────────────────────────────────
  if (len(world_p) > 95.0) {
    new_p = p * 0.35;
    new_v = vec3(0.0);
  }

  // ── Phase-3 Eternal Return: basin gravity ────────────────────────────────
  // Gradually pulls particles back to Lorenz attractor seat during reset
  if (u_pull > 0.001) {
    vec3 basin = vec3(wing_sign * 8.0, wing_sign * 8.0, 27.0); // near saddle point
    new_p = lerp(new_p, basin, u_pull * 0.045);
    new_v *= (1.0 - u_pull * 0.18);
  }

  // ── Transform Feedback output ─────────────────────────────────────────────
  v_p3 = new_p;
  v_v3 = new_v;
  v_pd = in_pd;

  // ── Projection for rendering ──────────────────────────────────────────────
  vec3  new_world = new_p + wing_center;
  vec3  new_rp    = u_rot * new_world;
  float new_persp = max(0.1, 1.0 + new_rp.z * FOV_DEPTH);
  vec2  new_sp    = vec2(new_rp.x * u_asp, new_rp.y) * SCENE_SCALE / new_persp;

  gl_Position  = vec4(new_sp, 0.0, 1.0);
  gl_PointSize = BIGNESS;

  // ── Color ─────────────────────────────────────────────────────────────────

  // Phase-1: orbital position → hue (z-height maps to color band)
  float z_norm  = clamp(p.z / 48.0, 0.0, 1.0);
  float h1      = fract(z_norm + wing * 0.16 + seed * 0.06);
  float l_speed = len(lorenz_f(p)) * DT;             // Lorenz orbit speed
  float v1      = 0.45 + 0.55 * smoothstep(0.1, 0.9, l_speed);
  vec3  col1    = hsv2rgb(vec3(h1, 0.90, v1));

  // Phase-2: velocity magnitude → hue, mouse proximity adds warm glow
  float spd2      = len(v);
  float h2        = fract(sqrt(spd2 * 9.0) * 1.6 + wing * 0.16);
  float mouse_glow= 1.0 - smoothstep(0.0, 0.22, dist);
  float h2_final  = fract(h2 + mouse_glow * 0.08);
  float v2        = clamp(0.35 + 0.65 * smoothstep(0.0, 0.07, spd2) + mouse_glow * 0.5, 0.0, 1.0);
  vec3  col2      = hsv2rgb(vec3(h2_final, 1.0, v2));

  vec3  final_col = lerp(col1, col2, t);
  float ev        = lerp(0.40, 0.30, t);

  // Treble drives a per-particle sparkle (high-freq shimmer)
  float sparkle = 1.0 + treble * abs(noise.x) * 1.6;
  final_col    *= sparkle;

  v_c = vec4(final_col, ev);
}
