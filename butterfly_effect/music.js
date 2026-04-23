/*
  music.js — 蝴蝶效應 background music manager
  API:
    startMusic(mode)   — call once on first user gesture; starts Mode 0 music
    setMusicMode(mode) — crossfade to the track for the given mode
    toggleMute()       — toggle master mute; returns new muted state
*/
(function MusicManager() {

  const TARGET_VOL = 0.60;   // master output level
  const FADE_DUR   = 2.50;   // crossfade duration in seconds

  // One mp3 per mode (Mode 0 has two tracks that alternate on each re-entry)
  const TRACKS = {
    0: [
      'Music/Mode 0（Lorenz 雙蝶）/Brian Eno - An Ending (Ascent) (Remastered 2019).mp3',
      'Music/Mode 0（Lorenz 雙蝶）/Nils Frahm - Says (Official Music Video).mp3',
    ],
    1: ['Music/Mode 1（Drift 漂流）/Marconi Union - Weightless (Official Video).mp3'],
    2: ['Music/Mode 2（Vortex 漩渦）/Max Richter - On the Nature of Daylight.mp3'],
    3: ['Music/Mode 3（Pulse 脈衝）/Theory of Everything - Ending Scene Music (The Cinematic Orchestra - Arrival of the birds).mp3'],
    4: ['Music/Mode 4（Gravity Well）/Ludovico Einaudi - Experience (Live from Teatro dal Verme, Milano).mp3'],
    5: ['Music/Mode 5（Wave Field）/Jon Hopkins - Open Eye Signal (Nosaj Thing remix).mp3'],
  };

  // Percent-encode each path segment so Chinese chars and parens work over HTTP
  function enc(rawPath) {
    return rawPath.split('/').map(encodeURIComponent).join('/');
  }

  let ctx        = null;
  let masterGain = null;
  let current    = null;   // { audio, src, gain }
  let activeMode = -1;
  let mode0Idx   = 0;      // alternates Mode 0's two tracks on each re-entry
  let muted      = false;

  function pickPath(m) {
    const list = TRACKS[m];
    const idx  = (m === 0) ? (mode0Idx % list.length) : 0;
    return enc(list[idx]);
  }

  function makeNode(path) {
    const audio = new Audio(path);
    audio.loop  = true;
    const src   = ctx.createMediaElementSource(audio);
    const gain  = ctx.createGain();
    src.connect(gain);
    gain.connect(masterGain);
    return { audio, src, gain };
  }

  function ramp(gainNode, from, to, dur) {
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setValueAtTime(from, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(to, ctx.currentTime + dur);
  }

  function fadeOut(node) {
    if (!node) return;
    ramp(node.gain, node.gain.gain.value, 0, FADE_DUR);
    setTimeout(() => {
      try { node.audio.pause(); node.src.disconnect(); node.gain.disconnect(); }
      catch (_) {}
    }, FADE_DUR * 1000 + 300);
  }

  function fadeIn(node) {
    ramp(node.gain, 0, 1, FADE_DUR);
    node.audio.play().catch(() => {});
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  window.startMusic = function (mode) {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = TARGET_VOL;
    masterGain.connect(ctx.destination);

    const node = makeNode(pickPath(mode));
    fadeIn(node);
    current    = node;
    activeMode = mode;
  };

  window.setMusicMode = function (newMode) {
    if (!ctx) return;
    if (newMode === activeMode) return;

    // Mode 0 re-entry → pick the other track
    if (newMode === 0) mode0Idx++;

    const next = makeNode(pickPath(newMode));
    fadeOut(current);
    fadeIn(next);
    current    = next;
    activeMode = newMode;
  };

  window.toggleMute = function () {
    if (!ctx) return false;
    muted = !muted;
    ramp(masterGain, masterGain.gain.value, muted ? 0 : TARGET_VOL, 0.5);
    return muted;
  };

})();
