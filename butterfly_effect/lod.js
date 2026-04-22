// Adaptive LOD — differential-only controller (khlorghaal style)
// Asymmetric: shrinks 5× faster than it grows to prevent frame drops

sat = _ => Math.max(0, Math.min(1, _));

var _lod     = 0.05;
var _lod_cap = 1.0;

function lod(dt) {
  const SHRINK = 0.25;
  const GROW   = 0.05;

  const target    = (1 / 60) * 1.05;
  const err       = dt - target;
  const tolerance = 2 * Math.max(dt * SHRINK, dt * GROW);

  let level = _lod;
  let cap   = _lod_cap;

  level += err > tolerance ? -dt * SHRINK : dt * GROW;

  if (err > tolerance) cap *= (1 - dt * SHRINK);

  cap   = sat(cap);
  level = sat(level);
  level = Math.min(level, cap);

  _lod     = level;
  _lod_cap = cap;

  return _lod;
}
