// Sound for the site, all synthesized with Web Audio (no sound files): a short
// click on every tap, and Copy the Pattern's pad tones. Loaded with a plain
// <script src> by every page; the hub's speaker button sets the site-wide
// mute flag read here.
// Browsers keep a
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

  // The tap click, rebuilt in code from Magnus's click (PLAY&LEARN_UI_01.mp3):
  // measured as a pure ~1075 Hz tone that reaches full level in 1ms, holds
  // ~4ms and is gone by ~9ms. Played at 45% of the original's level.
  // Synthesized rather than played from the file: Safari only plays a
  // fraction of that very short MP3, so the file sounded different per browser.
  var CLICK_HZ = 1075;
  var CLICK_LEVEL = 0.28 * 0.45;
  function click(){
    if (!ctx || isMuted()) return;
    // Not gated on 'running': a tap is itself the unlocking gesture, so audio
    // is about to start, and the click plays the moment it does.
    var t = ctx.currentTime;
    try {
      var out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(CLICK_LEVEL, t + 0.001);
      out.gain.setValueAtTime(CLICK_LEVEL, t + 0.005);
      out.gain.linearRampToValueAtTime(0, t + 0.0095);
      out.connect(ctx.destination);
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = CLICK_HZ;
      osc.connect(out);
      osc.start(t);
      osc.stop(t + 0.012);
      debug('click (audio ' + ctx.state + ')');
    } catch (e) {}
  }

  // A tap that leaves the page (hub tiles, "?", back buttons) would cut its
  // own click off. Hold the page change until audio is running -- the first
  // tap on a page can take several hundred ms on an iPhone to get there --
  // and then a short beat more for the click to sound.
  var NAV_DELAY = 150;
  var NAV_MAX_WAIT = 700;
  function go(url){
    if (isMuted() || !ctx) { window.location.href = url; return; }
    var left = false;
    function leave(){ if (!left) { left = true; window.location.href = url; } }
    var started = performance.now();
    (function waitForAudio(){
      if (ctx.state === 'running') setTimeout(leave, NAV_DELAY);
      else if (performance.now() - started > NAV_MAX_WAIT) leave();
      else setTimeout(waitForAudio, 20);
    })();
  }

  // One click for every tap on something tappable, on pages that opt in with
  // <html data-tap-sound> (being tried on Memory first). 'click' rather than
  // pointerdown so scrolling over tiles stays silent. Elements marked
  // data-own-sound (Copy the Pattern's pads) play their own sound instead.
  var TAPPABLE = 'a[href], button, .tile, .cell, .tap-cell, .pad, .cluster-card, .equation-tap';
  document.addEventListener('click', function(e){
    if (!document.documentElement.hasAttribute('data-tap-sound')) return;
    var el = e.target.closest && e.target.closest(TAPPABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (el.hasAttribute('data-own-sound')) return;
    click();
    // Plain same-tab links: delay the page change like go() does. Modified
    // clicks open new tabs -- leave them be.
    if (el.tagName === 'A' && !el.target && !e.defaultPrevented &&
        !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      go(el.href);
    }
  }, true);

  window.PLSound = { tone: tone, click: click, go: go, isMuted: isMuted, setMuted: setMuted };
})();
