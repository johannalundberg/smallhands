// Sound for the site: Copy the Pattern's pad tones -- the only sound there is.
// Loaded with a plain <script src> by Copy the Pattern (to play) and by the
// hub (whose speaker button sets the site-wide mute flag read here).
//
// The tones are synthesized with Web Audio (no sound files). Browsers keep a
// page silent until it has been tapped; an AudioContext resumed once inside a
// tap stays unlocked for the rest of the page, so later tones play on time.
(function(){
  "use strict";

  var MUTE_KEY = 'playandlearn.soundMuted';

  // Mix with (not stop) whatever else is playing, and follow the iPhone's
  // silent switch -- a kids' site shouldn't override either.
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) {}

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  if (AC) {
    try { ctx = new AC(); } catch (e) { ctx = null; }
  }

  // ?sounddebug in the URL shows a small on-screen log of every tone and the
  // audio state at that moment -- for diagnosing phone-only silence, where
  // there's no console to look at.
  var debugEl = null;
  if (/[?&]sounddebug\b/.test(location.search)) {
    document.addEventListener('DOMContentLoaded', function(){
      debugEl = document.createElement('pre');
      debugEl.style.cssText = 'position:fixed;left:4px;right:4px;bottom:4px;z-index:99999;margin:0;' +
        'max-height:40vh;overflow:auto;padding:6px 8px;background:rgba(0,0,0,0.8);color:#0f0;' +
        'font:11px/1.35 monospace;white-space:pre-wrap;pointer-events:none;';
      document.body.appendChild(debugEl);
      debug('loaded, audio ' + (ctx ? ctx.state : 'unsupported'));
    });
  }
  function debug(msg){
    if (!debugEl) return;
    var t = (performance.now() / 1000).toFixed(1);
    debugEl.textContent = (t + 's ' + msg + '\n' + debugEl.textContent).slice(0, 3000);
  }

  // Which events count as the unlocking tap differs between browsers and iOS
  // versions, so try on all of them. A silent one-sample buffer started inside
  // the gesture is what some iOS versions need beyond resume().
  var primed = false;
  function unlock(e){
    if (!ctx) return;
    if (ctx.state !== 'running') {
      if (e && e.type) debug('unlock attempt on ' + e.type + ' (audio ' + ctx.state + ')');
      try {
        var p = ctx.resume();
        if (p && p.then) p.then(function(){ debug('audio now ' + ctx.state); }, function(){});
      } catch (err) {}
    }
    if (!primed) {
      try {
        var silent = ctx.createBufferSource();
        silent.buffer = ctx.createBuffer(1, 1, 22050);
        silent.connect(ctx.destination);
        silent.start(0);
        primed = true;
      } catch (err) {}
    }
  }
  ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'].forEach(function(type){
    document.addEventListener(type, unlock, { capture: true, passive: true });
  });

  function isMuted(){
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }
  function setMuted(muted){
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
  }

  // A soft, marimba-like note: a sine at the pitch plus a brief quiet overtone
  // four times higher for the mallet "knock", fast attack, ~0.45s decay.
  // Notes are C5 E5 G5 A5, a pentatonic set, so any sequence sounds musical.
  var TONE_HZ = [523.25, 659.25, 783.99, 880.00];
  var TONE_LEVEL = 0.3;
  function tone(i){
    // Never queued while the page is still locked -- a pattern's notes only
    // make sense in time with the pads lighting up.
    if (!ctx || isMuted() || ctx.state !== 'running') {
      debug('tone ' + i + ': skipped (audio ' + (ctx ? ctx.state : 'none') + (isMuted() ? ', muted' : '') + ')');
      return;
    }
    var f = TONE_HZ[i % TONE_HZ.length];
    var t = ctx.currentTime;
    try {
      var out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(TONE_LEVEL, t + 0.006);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      out.connect(ctx.destination);

      var body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.value = f;
      body.connect(out);

      var knock = ctx.createOscillator();
      var knockGain = ctx.createGain();
      knock.type = 'sine';
      knock.frequency.value = f * 4;
      knockGain.gain.setValueAtTime(0.25, t);
      knockGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      knock.connect(knockGain);
      knockGain.connect(out);

      body.start(t); knock.start(t);
      body.stop(t + 0.5); knock.stop(t + 0.5);
      debug('tone ' + i);
    } catch (e) {}
  }

  window.PLSound = { tone: tone, isMuted: isMuted, setMuted: setMuted };
})();
