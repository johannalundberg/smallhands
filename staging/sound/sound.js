// Shared sound player for every page. Loaded with a plain <script src> from
// each page (../sound.js from a game, sound.js from the hub), so sound files
// resolve next to this file no matter which page loaded it.
//
// Web Audio instead of <audio> elements: iOS only lets a page start sound
// from inside a tap, but most of these sounds fire later from a setTimeout
// (a celebration 700ms after the last answer, the bot's winning move...).
// An AudioContext resumed once inside any tap stays unlocked for the rest of
// the page, so later sounds play whenever they're asked for.
//
// Mute state lives in localStorage and is only toggled from the hub's speaker
// button; every page just reads it before playing.
(function(){
  "use strict";

  var MUTE_KEY = 'playandlearn.soundMuted';
  var base = document.currentScript.src.replace(/[^\/]*$/, '') + 'sounds/';
  var FILES = {
    click:    'click.mp3',
    drag:     'drag.mp3',
    positive: 'positive.mp3',
    negative: 'negative.mp3',
    complete: 'complete.mp3',
    tryagain: 'tryagain.mp3'
  };
  // Per-sound playback level (1 = as delivered). The right/wrong sounds play
  // many times per game, so they sit a bit under the click.
  var VOLUME = { positive: 0.6, negative: 0.6 };

  // Mix with (not stop) whatever else is playing, and follow the iPhone's
  // silent switch -- a kids' site shouldn't override either.
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) {}

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var buffers = {};
  if (AC) {
    try { ctx = new AC(); } catch (e) { ctx = null; }
  }
  if (ctx) {
    Object.keys(FILES).forEach(function(name){
      fetch(base + FILES[name])
        .then(function(r){ return r.arrayBuffer(); })
        .then(function(data){
          // Callback form, not the promise form: older iOS Safari only has this one.
          ctx.decodeAudioData(data, function(buf){ buffers[name] = buf; }, function(){});
        })
        .catch(function(){});
    });
  }

  // iOS only unlocks audio from inside a gesture, and which events count has
  // shifted between versions -- so try on every touch/pointer event, not just
  // the end of a tap: Number Puzzle is played entirely by dragging, and a
  // drag's touchend alone didn't unlock it there. A silent one-sample buffer
  // started inside the gesture is what some iOS versions need beyond resume().
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
      } catch (e) {}
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

  // ?sounddebug in the URL shows a small on-screen log of every sound request
  // and the audio state at that moment -- for diagnosing iPhone-only silence,
  // where there's no console to look at.
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
    setInterval(function(){
      if (debugEl) debugEl.dataset.state = ctx ? ctx.state : '-';
    }, 500);
  }
  function debug(msg){
    if (!debugEl) return;
    var t = (performance.now() / 1000).toFixed(1);
    debugEl.textContent = (t + 's ' + msg + '\n' + debugEl.textContent).slice(0, 3000);
  }

  function play(name){
    debug(name + ': audio ' + (ctx ? ctx.state : 'none') +
      (buffers[name] ? '' : ', NOT LOADED') + (isMuted() ? ', MUTED' : ''));
    if (!ctx || !buffers[name] || isMuted()) return;
    unlock();
    try {
      var src = ctx.createBufferSource();
      src.buffer = buffers[name];
      if (VOLUME[name] != null) {
        var gain = ctx.createGain();
        gain.gain.value = VOLUME[name];
        src.connect(gain);
        gain.connect(ctx.destination);
      } else {
        src.connect(ctx.destination);
      }
      src.start(0);
      // Asked for while iOS still has the page locked: it would sit queued
      // and burst out on the next real tap (Number Puzzle's positive sound
      // playing when Back was pressed). Keep it only if the unlock lands
      // right away, as it does when this tap itself is the unlocking one.
      if (ctx.state !== 'running') pending.push({ src: src, at: performance.now() });
    } catch (e) {}
  }
  var pending = [];
  var STALE_MS = 300;
  if (ctx) {
    ctx.onstatechange = function(){
      if (ctx.state !== 'running') return;
      var now = performance.now();
      pending.forEach(function(p){
        if (now - p.at > STALE_MS) { try { p.src.stop(); } catch (e) {} }
      });
      pending = [];
    };
  }

  // Leaving the page stops its sound instantly, so a tap that navigates (a
  // hub tile, a back button) would cut its own click off before it's heard.
  // Hold the page change just long enough for the click to play.
  var NAV_DELAY = 150;
  function go(url){
    if (isMuted() || !ctx) { window.location.href = url; return; }
    setTimeout(function(){ window.location.href = url; }, NAV_DELAY);
  }

  // One click sound for every tap on something tappable, site-wide, so no page
  // has to wire it per button. 'click' rather than pointerdown so scrolling the
  // hub over its tiles stays silent. Number Puzzle's pieces are dragged, not
  // clicked, so that page plays its own click on pickup instead.
  // Elements marked data-own-sound (Copy the Pattern's pads) play their own
  // sound instead of the click.
  var CLICKABLE = 'a[href], button, .tile, .cell, .tap-cell, .pad, .cluster-card, .equation-tap';
  document.addEventListener('click', function(e){
    var el = e.target.closest && e.target.closest(CLICKABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (el.hasAttribute('data-own-sound')) return;
    play('click');
    // Plain same-tab links (hub tiles, "?", About's back arrow): delay the
    // page change like go() does. Modified clicks open new tabs, leave them be.
    if (el.tagName === 'A' && !el.target && !e.defaultPrevented &&
        !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      go(el.href);
    }
  }, true);

  // Synthesized tones (no sound files): a soft, marimba-like note -- a sine
  // at the pitch plus a brief quiet overtone four times higher for the
  // mallet "knock", fast attack, ~0.45s decay. Notes are C5 E5 G5 A5, a
  // pentatonic set, so any sequence of them sounds musical.
  var TONE_HZ = [523.25, 659.25, 783.99, 880.00];
  var TONE_LEVEL = 0.3;
  function tone(i){
    // Not queued while iOS still has the page locked -- a pattern's notes
    // only make sense in time with the pads lighting up.
    if (!ctx || isMuted() || ctx.state !== 'running') { debug('tone ' + i + ': skipped'); return; }
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

  window.PLSound = { play: play, tone: tone, go: go, isMuted: isMuted, setMuted: setMuted };
})();
