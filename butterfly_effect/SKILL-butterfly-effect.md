# SKILL: 蝴蝶效應 — GPU 驅動的三相混沌粒子系統
## 基於 Lorenz Attractor 的互動數位抽象藝術技術設計文件

> **技術棧**：WebGL2 · GLSL 300 es · p5.js · Transform Feedback · Web Audio API  
> **創作主題**：繽紛閃爍的光點粒子，在三維空間中構成混沌蝴蝶形流形，回應滑鼠與音樂  
> **靈感來源**：khlorghaal — Rainbow Gravity（Transform Feedback 架構參考）

---

## 一、創作核心哲學 Core Philosophy

> **「混沌本身就是美學。蝴蝶效應的視覺語言，正是微小擾動在非線性系統中無限放大的過程。」**

本作建立在三個層疊的張力之上：

1. **秩序 ↔ 混沌**：Lorenz 吸引子是確定性系統，卻永遠不重複軌跡，這種「確定的混沌」正是蝴蝶效應的物理本質。
2. **粒子 ↔ 波動**：光點既有粒子的位置，又以漣漪波動的形式回應外力，呼應光的波粒二象性。
3. **在場 ↔ 消逝**：滑鼠一觸，秩序瞬間瓦解；長按歸零，輪迴再起。每次介入都是不可逆的「轉瞬」。

| 設計決策 | 技術意涵 |
|----------|----------|
| 三維 Lorenz 吸引子投影至二維 | 透視旋轉製造「蝴蝶在空間翻飛」的立體感 |
| 雙組獨立初始條件 | 兩個蝴蝶形流形，實現「比翼雙飛」的雙重混沌結構 |
| 滑鼠破壞 Lorenz 約束 | 相位轉換的物理隱喻：觀察者的介入改變了系統 |
| Web Audio API 頻譜驅動 | 聲音成為第二個「蝴蝶效應的起始擾動」 |

---

## 二、架構設計 Architecture

### 2.1 Transform Feedback Ping-Pong 雙緩衝（繼承自 khlorghaal）

粒子狀態永遠留在 GPU，CPU 只傳遞 uniform：

```
Frame N:
  讀  ping.VAO  (in_p3, in_v3, in_phase_data)
  寫  pong.XFB  (v_p3,  v_v3,  v_phase_data)  ← TF 攔截
  渲染到螢幕（3D 投影 + 色彩計算）

Frame N+1:
  交換 ping ↔ pong
  讀  pong.VAO
  ···
```

頂點 buffer 擴展為三維，新增相位資料欄：

```javascript
// 每個粒子：位置(3) + 速度(3) + 相位資料(2) = 8 個 float
const STRIDE = 8;

function createParticleBuffer(n) {
    const data = new Float32Array(n * STRIDE);
    for (let i = 0; i < n; i++) {
        const wing = i < n/2 ? 0 : 1;  // 0=左翼, 1=右翼
        const offset = i * STRIDE;
        // 在 Lorenz 吸引子盆地附近隨機初始化
        data[offset+0] = (Math.random()-0.5) * 2.;   // x
        data[offset+1] = (Math.random()-0.5) * 2.;   // y
        data[offset+2] = Math.random() * 5. + 20.;   // z（避開奇點）
        // 速度初始為零
        data[offset+6] = wing;          // 翼別標記
        data[offset+7] = Math.random(); // 相位偏移（色彩抖動用）
    }
    return data;
}
```

Transform Feedback varyings：

```javascript
gl.transformFeedbackVaryings(
    sh._glProgram,
    ['v_p3', 'v_v3', 'v_pd'],   // 位置、速度、相位資料
    gl.SEPARATE_ATTRIBS
);
```

### 2.2 三相狀態機 Three-Phase State Machine

狀態由 CPU 管理，以 uniform 傳入 shader：

```javascript
const Phase = { SIDE_BY_SIDE: 0, EPHEMERAL: 1, ETERNAL_RETURN: 2 };

let state = {
    phase: Phase.SIDE_BY_SIDE,
    transition: 0.0,    // 0=完全 Phase1, 1=完全 Phase2
    resetTimer: 0.0,    // 長按右鍵計時
};

function updatePhase(dt) {
    const mouseActive = framesSinceMouseMove < 120;

    if (mouseButtons[2] && state.phase !== Phase.SIDE_BY_SIDE) {
        // 長按右鍵：漸進歸零
        state.resetTimer += dt;
        if (state.resetTimer > 1.5) enterPhase1();
    } else {
        state.resetTimer = 0;
    }

    if (mouseActive && state.phase === Phase.SIDE_BY_SIDE) {
        state.phase = Phase.EPHEMERAL;
    }

    // 平滑過渡
    const target = state.phase === Phase.SIDE_BY_SIDE ? 0. : 1.;
    state.transition += (target - state.transition) * dt * 2.;
}
```

---

## 三、頂點著色器即物理引擎 Vertex Shader as Physics Engine

### 3.1 宣告與資料流

```glsl
#version 300 es
precision highp float;

layout(location=0) in vec3 in_p3;  // 3D 位置
layout(location=1) in vec3 in_v3;  // 3D 速度
layout(location=2) in vec2 in_pd;  // [翼別(0/1), 相位偏移]

out vec3 v_p3;      // TF 輸出：新 3D 位置
out vec3 v_v3;      // TF 輸出：新 3D 速度
out vec2 v_pd;      // TF 直通：相位資料不變
flat out vec4 v_c;  // 渲染輸出：顏色（flat 不插值）

uniform mat4  u_rot;         // 3D 旋轉矩陣
uniform vec2  u_mouse;       // 螢幕空間滑鼠位置
uniform float u_transition;  // Phase1↔Phase2 混合 [0,1]
uniform float u_time;
uniform float u_energy;      // 滑鼠能量強度
uniform vec3  u_audio;       // [bass, mid, treble]
uniform ivec2 u_buttons;     // [左鍵, 右鍵]
```

### 3.2 Lorenz 系統：RK4 積分

使用 RK4（而非 Forward Euler）確保 Phase1 的吸引子軌道穩定，長期不發散：

```glsl
const float L_SIGMA = 10.0;   // σ 普朗特數
const float L_RHO   = 28.0;   // ρ 瑞利數
const float L_BETA  = 2.6667; // β = 8/3

vec3 lorenz_f(vec3 p) {
    return vec3(
        L_SIGMA * (p.y - p.x),
        p.x * (L_RHO - p.z) - p.y,
        p.x * p.y - L_BETA * p.z
    );
}

vec3 lorenz_rk4(vec3 p, float dt) {
    vec3 k1 = lorenz_f(p);
    vec3 k2 = lorenz_f(p + .5*dt*k1);
    vec3 k3 = lorenz_f(p + .5*dt*k2);
    vec3 k4 = lorenz_f(p + dt*k3);
    return p + (dt/6.) * (k1 + 2.*k2 + 2.*k3 + k4);
}
```

**為何 Phase1 用 RK4 而非 Forward Euler**：

| 積分方法 | Phase1 需求 | Phase2 需求 |
|----------|-------------|-------------|
| Forward Euler | 累積誤差使軌跡脫離吸引子 | 混沌發散正是視覺目標 |
| **RK4** | **精確追蹤 Lorenz 軌道，蝴蝶形狀清晰** | 過於穩定，視覺無趣 |

Phase2 下降回 Forward Euler，藉由積分誤差製造混沌視覺：

```glsl
const float DT_LORENZ = 0.005;  // Lorenz 時間步長（調校值）

vec3 new_p3;
if (u_transition < 0.01) {
    // Phase1：純 RK4 Lorenz
    new_p3 = lorenz_rk4(in_p3, DT_LORENZ);
} else {
    // Phase2：RK4 混合 Forward Euler，依 transition 比例
    vec3 p_rk4 = lorenz_rk4(in_p3, DT_LORENZ);
    vec3 p_euler = in_p3 + in_v3;
    new_p3 = mix(p_rk4, p_euler, u_transition);
}
```

### 3.3 雙翼偏移：比翼雙飛的結構

兩翼使用相同 Lorenz 方程，但以空間偏移製造「並排」的視覺：

```glsl
const float WING_OFFSET = 12.0;  // 左右翼的橫向間距

float wing_sign = in_pd.x < 0.5 ? -1. : 1.;
vec3 wing_center = vec3(wing_sign * WING_OFFSET, 0., 25.);

// 以翼中心為原點運算 Lorenz
vec3 local_p = in_p3 - wing_center;
vec3 new_local = lorenz_rk4(local_p, DT_LORENZ * (1. - u_transition));
new_p3 = new_local + wing_center;
```

### 3.4 三維旋轉投影

3D 位置經旋轉後投影到螢幕空間，製造蝴蝶在空間翻飛的立體感：

```glsl
const float FOV_DEPTH = 0.015;  // 透視強度

vec4 rotated = u_rot * vec4(new_p3, 1.0);
// 透視除法（弱透視，保持空間感但不過度變形）
float persp = 1.0 / (1.0 + rotated.z * FOV_DEPTH);
vec2 screen_pos = rotated.xy * persp * 0.03;  // 縮放到 [-1,1] 範圍

gl_Position = vec4(screen_pos, 0., 1.);
```

CPU 端驅動緩慢自轉（Phase1）或依滑鼠旋轉（Phase2）：

```javascript
// Phase1：自動緩慢自轉（繞 Y 軸 + 繞 X 軸漂移）
function updateRotation(dt, mouseX, mouseY, transition) {
    autoRotY += dt * 0.003;
    autoRotX += dt * 0.001;

    // Phase2：滑鼠影響旋轉視角
    const targetRotX = lerp(autoRotX, mouseY * 0.8, transition);
    const targetRotY = lerp(autoRotY, autoRotY + mouseX * 0.3, transition);

    rotMatrix = mat4RotXY(targetRotX, targetRotY);
}
```

---

## 四、Phase2 互動物理 Ephemeral Glimpse Physics

### 4.1 滑鼠能量核心：漣漪擾動場

當 `u_transition > 0` 時，滑鼠在螢幕空間形成能量核心，對周圍粒子施加漣漪形擾動力：

```glsl
vec2 screen_xy = screen_pos;  // 粒子在螢幕空間的投影位置
vec2 to_mouse = screen_xy - u_mouse;
float dist = max(0.001, length(to_mouse));

// 行進波：從滑鼠中心向外擴散的環形波
float wave_k    = 18.0;                           // 空間頻率
float wave_spd  = 2.5;                            // 波速
float wave_arg  = dist * wave_k - u_time * wave_spd;
float wave_amp  = exp(-dist * 4.0);               // 距離衰減包絡
float wave      = sin(wave_arg) * wave_amp;

// 漣漪力（沿徑向方向）
vec2 ripple_2d  = normalize(to_mouse) * wave * u_energy * 0.008;

// 能量核心近場：強吸引/排斥切換
float core_zone = smoothstep(0.15, 0.0, dist);
vec2  core_pull = -normalize(to_mouse) * core_zone * u_energy * 0.02;

// 合力加入 Phase2 的 Forward Euler 速度
if (u_transition > 0.01) {
    vec2 mouse_force = (ripple_2d + core_pull) * u_transition;
    // 注意：只擾動 xy 分量，z 軸自由衰減
    v3_next.xy += mouse_force;
}
```

### 4.2 音頻響應 Audio Reactivity

CPU 端每幀分析 Web Audio API 的 FFT 輸出，傳入三個頻段 uniform：

```javascript
// CPU 端：Web Audio API 分析
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 256;
const freqData = new Uint8Array(analyser.frequencyBinCount);

function getAudioBands() {
    analyser.getByteFrequencyData(freqData);
    const len = freqData.length;
    const bass   = avg(freqData, 0,        Math.floor(len*0.1));  // 20–200Hz
    const mid    = avg(freqData, Math.floor(len*0.1), Math.floor(len*0.5)); // 200–2kHz
    const treble = avg(freqData, Math.floor(len*0.5), len);       // 2k–12kHz
    return [bass/255, mid/255, treble/255];
}
```

GPU 端：頻段驅動粒子行為：

```glsl
// Bass：擴張粒子運動半徑（低頻「搏動」感）
float bass_pulse  = 1.0 + u_audio.x * 0.4;
v3_next *= bass_pulse;

// Mid：增加旋轉分量（中頻製造旋渦）
float mid_curl = u_audio.y * 0.003;
vec2 curl_2d = vec2(-v3_next.y, v3_next.x) * mid_curl;
v3_next.xy += curl_2d;

// Treble：高頻加入噪音抖動（高頻製造「閃爍」）
vec3 noise = nse_3_3(vec3(in_p3 * 0.1 + u_time * 0.01));
v3_next += noise * u_audio.z * 0.015;
```

### 4.3 左鍵：超強能量爆發

```glsl
if (u_buttons.x != 0) {
    // 左鍵：能量核心從吸引轉為排斥爆炸
    float impulse = u_energy * 0.05 / max(0.01, dist*dist);
    v3_next.xy += normalize(to_mouse) * impulse;
}
```

---

## 五、Phase3 永恆輪迴 Eternal Return

長按右鍵超過 1.5 秒後，在 CPU 端重置粒子狀態到 Lorenz 盆地：

```javascript
function enterPhase1() {
    state.phase = Phase.SIDE_BY_SIDE;
    state.resetTimer = 0;

    // 重新初始化粒子到 Lorenz 盆地的隨機位置
    const newData = createParticleBuffer(n);

    // 上傳重置後的資料到 GPU（只在 Phase3 發生，不影響幀率）
    gl.bindBuffer(gl.ARRAY_BUFFER, ping.vbo_p);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, newData);
    pingpong();
}
```

**視覺過渡**：重置不是瞬間跳切，而是在 `u_transition` 滑回 0 的過程中，粒子從 Phase2 的散亂狀態被 Lorenz 方程「重新吸引」到蝴蝶形軌道，形成從混沌凝聚成秩序的視覺詩意。

---

## 六、彩虹配色系統 Rainbow Color System

### 6.1 Phase1：Lorenz 軌道位置色

Lorenz 吸引子的 z 軸值域約 [0, 50]，x 軸值域約 [-20, 20]。以 z 高度映射色相，製造「蝴蝶翅膀由內到外的漸層感」：

```glsl
// Phase1：Lorenz 軌道的位置色
float lorenz_hue = fract(in_p3.z / 48.0);        // z → 色相（0=紅，0.6=藍）
float lorenz_sat = 0.85 + 0.15 * sin(u_time * 0.3 + in_pd.y * 6.28); // 緩慢呼吸
float speed1     = length(lorenz_f(in_p3));       // Lorenz 導數大小 = 軌道速率
float lorenz_val = 0.5 + 0.5 * smoothstep(0., 30., speed1);
vec3  col1 = hsv2rgb(vec3(lorenz_hue, lorenz_sat, lorenz_val));
```

### 6.2 Phase2：速度 + 距離混合色

```glsl
// Phase2：速度色（繼承自 khlorghaal 的速度→色相映射）
float speed2     = length(in_v3);
float speed_hue  = fract(sqrt(speed2 * 3.) * 2.5);
float speed_val  = 0.4 + 0.6 * smoothstep(0., 0.1, speed2);

// 距離滑鼠的色相偏移（近滑鼠 → 暖色；遠滑鼠 → 冷色）
float dist_norm  = clamp(dist / 0.5, 0., 1.);
float dist_hue   = mix(0.05, 0.65, dist_norm);   // 橙→藍
float hue2       = mix(dist_hue, speed_hue, 0.5);
vec3  col2 = hsv2rgb(vec3(hue2, 1.0, speed_val));
```

### 6.3 雙翼色調分離

兩翼略有不同的色相偏移，形成視覺上「兩隻蝴蝶」的感知：

```glsl
float wing_hue_offset = in_pd.x < 0.5 ? 0.0 : 0.15;  // 右翼偏移 15% 色相
float final_hue = fract(lerp_hue + wing_hue_offset);
```

### 6.4 Phase 混合 + 透明度

```glsl
const float EV1 = 0.35;  // Phase1 透明度（稍高，軌跡清晰）
const float EV2 = 0.25;  // Phase2 透明度（稍低，密集時不過曝）

vec3  final_col = mix(col1, col2, u_transition);
float final_ev  = mix(EV1, EV2, u_transition);

// Treble 驅動閃爍：高頻時粒子隨機閃亮
float sparkle = 1.0 + u_audio.z * nse_3_3(vec3(in_p3*0.5+u_time)).x * 1.5;
v_c = vec4(final_col * sparkle, final_ev);
```

**背景選用深黑（0.04, 0.02, 0.06）**，帶微量紫色調。使用加算混合（`ONE, ONE`）而非 SRC_ALPHA，讓粒子疊加形成自然的光暈發光效果，製造「繁星」般的夢幻感。

---

## 七、LOD 自適應品質系統 Adaptive LOD

繼承 khlorghaal 的非對稱 D-only 控制器，針對本作的雙翼對稱性作一處修改：LOD 調整時保持偶數，確保兩翼粒子數量始終相等：

```javascript
const N_MAX  = 2e6;    // 100萬 × 2翼 = 200萬粒子上限
const SHRINK = 0.25;
const GROW   = 0.04;

let lod = 0.3;
let lod_cap = 1.0;

function updateLOD(dt_ms) {
    const target = (1/60) * 1.05;
    const err    = dt_ms/1000 - target;
    const tol    = 0.002;

    lod += err > tol ? -dt_ms/1000 * SHRINK : dt_ms/1000 * GROW;
    if (err > tol) lod_cap *= (1 - SHRINK * 0.1);
    lod = Math.min(Math.max(lod, 0.01), lod_cap);

    // 確保兩翼對稱：取偶數
    return Math.floor(lod * N_MAX / 2) * 2;
}
```

---

## 八、GLSL 工具函式庫 Utility Patterns

```glsl
// 別名（繼承 khlorghaal 風格）
#define len    length
#define lerp   mix
#define norm   normalize
#define frc    fract
#define sat    clamp

// 防奇點 epsilon
const float ETA = 1.23456e-9;

// 3D 雜湊噪音（khlorghaal 原版，用於 Phase2 高頻抖動）
vec3 nse_3_3(vec3 v) {
    uvec3 x = uvec3(v * 4321.);
    const uint k = 1103515245U;
    x = ((x>>8U)^x.yzx)*k;
    x = ((x>>8U)^x.yzx)*k;
    return vec3(x) * (2.0/float(0xffffffffU)) - 1.;
}

// HSV ↔ RGB（標準實作）
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(frc(c.xxx + vec3(0.,2./3.,1./3.)) * 6. - 3.);
    return c.z * mix(vec3(1.), sat(p - 1., 0., 1.), c.y);
}

// 亮度感知（BT.709）
const vec3 LUMVEC = vec3(0.2126, 0.7152, 0.0722);
float lum(vec3 c) { return dot(c, LUMVEC); }

// 旋轉矩陣（CPU 端）
function mat4RotXY(rx, ry) {
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    // 行主序，傳入 WebGL 前轉置
    return new Float32Array([
        cy,    sx*sy, cx*sy, 0,
        0,     cx,   -sx,    0,
       -sy,    sx*cy, cx*cy, 0,
        0,     0,     0,     1
    ]);
}
```

---

## 九、常數與參數調校 Constants & Tuning

```glsl
// Lorenz 系統
const float L_SIGMA     = 10.0;    // 普朗特數（對流強度）
const float L_RHO       = 28.0;    // 瑞利數（28 = 混沌臨界點以上）
const float L_BETA      = 2.6667;  // 幾何因子（8/3）
const float DT_LORENZ   = 0.005;   // Lorenz 時間步長（過大則軌跡崩潰）

// 空間佈局
const float WING_OFFSET = 12.0;    // 雙翼橫向間距（Lorenz x 值域 ~[-20,20]）
const float FOV_DEPTH   = 0.015;   // 透視深度（越大立體感越強）

// 粒子視覺
const float EV1         = 0.35;    // Phase1 透明度
const float EV2         = 0.25;    // Phase2 透明度
const float SPARKLE_AMP = 1.5;     // 高頻閃爍幅度

// 互動物理
const float WAVE_K      = 18.0;    // 漣漪空間頻率（越大漣漪越密）
const float WAVE_SPD    = 2.5;     // 漣漪傳播速度
const float WAVE_DECAY  = 4.0;     // 距離衰減率
const float CORE_RADIUS = 0.15;    // 能量核心影響半徑

// 音頻
const float BASS_SCALE  = 0.4;     // Bass 脈動幅度
const float MID_CURL    = 0.003;   // Mid 旋渦強度
const float TREBLE_NOISE= 0.015;   // Treble 噪音強度

// 自轉速率
const float ROT_Y_SPEED = 0.003;   // Y 軸自轉（rad/ms）
const float ROT_X_DRIFT = 0.001;   // X 軸漂移
```

**L_RHO = 28 是混沌的關鍵**：低於 ~24.74 時系統收斂到固定點，蝴蝶形流形消失；高於 28 則軌道更為複雜但視覺上過於雜亂。28 是「最美的混沌」。

---

## 十、可延伸的設計模式 Extensible Patterns

### 10.1 多蝴蝶群：N 組吸引子

```glsl
uniform vec3  u_wing_centers[6];  // 最多 6 組翼中心
uniform float u_wing_weights[6];  // 各組的粒子分配權重

// 粒子依 in_pd.x 決定從屬的翼
int wing_id = int(in_pd.x * 6.0);
vec3 center = u_wing_centers[wing_id];
vec3 local_p = in_p3 - center;
vec3 new_local = lorenz_rk4(local_p, DT_LORENZ * (1.-u_transition));
v_p3 = new_local + center;
```

### 10.2 Lorenz 參數動態調變

Rho 緩慢振盪可製造「在混沌邊緣呼吸」的效果：

```glsl
// 在 shader 中讓 rho 成為 uniform 並在 CPU 端隨時間調變
uniform float u_rho;  // 基礎 28.0，可振盪 ±3

// CPU 端
rho = 28.0 + Math.sin(time * 0.0003) * 3.0 * (1 - transition);
```

### 10.3 粒子壽命系統（光點消逝效果）

在 in_pd.y 存放生命計時器，加入衰老效果：

```glsl
float age = frc(in_pd.y + u_time * 0.02);  // 緩慢循環老化
float life_alpha = smoothstep(0., 0.1, age) * smoothstep(1., 0.85, age);
v_c.a *= life_alpha;  // 生命末期淡出
```

### 10.4 波動干涉紋 Wave Interference Pattern

兩翼的能量場相互疊加形成干涉條紋：

```glsl
// 兩翼發出徑向波，在中心區域產生干涉
vec2 to_left  = screen_pos - vec2(-0.3, 0.);
vec2 to_right = screen_pos - vec2( 0.3, 0.);
float wave_l  = sin(length(to_left)  * 30. - u_time * 2.);
float wave_r  = sin(length(to_right) * 30. - u_time * 2.);
float interference = (wave_l + wave_r) * 0.5;  // [-1, 1]
// 用於調製透明度，製造條紋閃爍
v_c.a *= 0.7 + 0.3 * interference;
```

---

## 十一、技術風格特徵總結 Signature Characteristics

| 特徵 | 具體表現 |
|------|----------|
| **混沌即秩序** | Lorenz RK4 的精確軌道是秩序；Phase2 的 Forward Euler 累積誤差是混沌 |
| **三相詩學** | Phase1（比翼）→ Phase2（轉瞬）→ Phase3（輪迴）構成完整的生命隱喻 |
| **觀察者效應** | 滑鼠的介入破壞量子態般破壞混沌吸引子，呼應蝴蝶效應的哲學 |
| **聲音即物理** | 音樂頻譜直接成為粒子的力場，聲音「看得見」 |
| **雙翼對稱性** | 兩組吸引子始終保持粒子數對稱，LOD 調整時維持偶數 |
| **波粒雙象** | 粒子有位置（粒子性），漣漪波動是波動性，兩者同時呈現 |
| **極深黑底** | 加算混合 + 深黑背景 → 自發光效果，製造光源感而非反射光感 |

---

## 十二、互動設計總覽 Interaction Summary

| 操作 | 相位狀態 | 物理機制 | 視覺效果 |
|------|----------|----------|----------|
| 無操作 | Phase1（比翼） | RK4 Lorenz 軌道 | 兩組蝴蝶形混沌流形緩慢自轉 |
| 移動滑鼠 | Phase2（轉瞬） | 打破 Lorenz 約束，進入漣漪場 | 秩序瓦解，光點回應游標 |
| 按住左鍵 | Phase2 強化 | 能量核心爆炸排斥 | 粒子從游標中心急速噴散 |
| 播放音樂 | Phase2 音頻響應 | Bass/Mid/Treble 各驅動一種力 | 粒子隨音樂律動、旋轉、閃爍 |
| 長按右鍵 1.5 秒 | Phase3（輪迴） | 重置粒子至 Lorenz 盆地 | 混沌重新凝聚成蝴蝶形 |

---

## 十三、學習路徑 Learning Path

1. **Lorenz 系統數學** — 了解 σ、ρ、β 參數的物理意涵與混沌臨界值
2. **WebGL2 Transform Feedback** — 掌握 Ping-Pong 緩衝的雙 VAO + XFB 架構
3. **RK4 vs Forward Euler** — 理解積分精度如何影響混沌系統的視覺穩定性
4. **Web Audio API FFT** — AnalyserNode 的頻譜資料如何採樣並映射到粒子行為
5. **3D 投影與旋轉** — 旋轉矩陣 + 弱透視投影在粒子系統中的實作
6. **加算混合 vs Alpha 混合** — 兩種混合模式在深色背景上的發光效果差異
7. **HSV 配色設計** — 如何讓位置/速度/頻譜等物理量優雅地映射到感知色彩

---

*Skill Version: 1.0 | 創作主題：蝴蝶效應 Butterfly Effect | 架構參考：Rainbow Gravity by khlorghaal (CC BY-NC-SA 3.0)*  
*技術設計：結合 Lorenz Attractor 混沌系統、三相狀態機、Web Audio API 頻譜驅動*
