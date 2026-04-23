// Adaptive LOD — differential-only controller (khlorghaal style)
// Asymmetric: shrinks 5× faster than it grows to prevent frame drops
// Minimum guaranteed particle ratio: 12% (never goes fully dark)

sat = _ => Math.max(0, Math.min(1, _));

var _lod     = 0.05;
var _lod_cap = 1.0;

function lod(dt) {
  const SHRINK = 0.25;
  const GROW   = 0.05;
  const MIN    = 0.12;   // floor: always render at least 12% of N_MAX

  const target    = (1 / 60) * 1.05;
  const err       = dt - target;
  const tolerance = 2 * Math.max(dt * SHRINK, dt * GROW);

  let level = _lod;
  let cap   = _lod_cap;

  level += err > tolerance ? -dt * SHRINK : dt * GROW;

  if (err > tolerance) cap *= (1 - dt * SHRINK);

  cap   = Math.max(MIN, sat(cap));
  level = Math.max(MIN, sat(level));
  level = Math.min(level, cap);

  _lod     = level;
  _lod_cap = cap;

  return _lod;
}

// Called by resetToPhase1() to restore healthy starting values after Phase 3
function resetLod() {
  _lod     = 0.40;
  _lod_cap = 1.0;
}
