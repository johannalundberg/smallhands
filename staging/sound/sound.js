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

  // Mix with (not stop) whatever else is playing, and follow the iPhone's
  // silent switch -- a kids' site shouldn't override either.
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) {}

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  if (AC) {
    try { ctx = new AC(); } catch (e) { ctx = null; }
  }

  // Recorded sounds (Magnus's UI toolbox, PLAY&LEARN_UI_03 / _04 / _07 / _08), kept as
  // WAV: Safari's Web Audio played a short MP3 silently. URLs are versioned
  // so a browser never reuses a stale cached copy.
  var base = document.currentScript.src.replace(/[^\/]*$/, '') + 'sounds/';
  var FILES = {
    positive: 'positive.wav',
    negative: 'negative.wav',
    complete: 'complete.wav',  // with the big win smiley
    tryagain: 'tryagain.wav'   // with the sad face
  };
  // Playback level per sound (1 = as delivered). The short right/wrong sounds
  // play many times per game, so they sit lowest.
  var VOLUME = { positive: 0.35, negative: 0.35, complete: 0.45, tryagain: 0.45 };
  var buffers = {};
  if (ctx) {
    Object.keys(FILES).forEach(function(name){
      fetch(base + FILES[name] + '?v=20261025za')
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

  // The click, rebuilt in code from Magnus's click file (PLAY&LEARN_UI_01.mp3):
  // measured as a pure ~1075 Hz tone that reaches full level in 1ms, holds
  // ~4ms and is gone by ~9ms. Played at 45% of the original's level. In code
  // rather than from the file because Safari played that very short MP3
  // silently, while every browser plays this the same.
  // Every click and tone is scheduled a hair ahead of the audio clock. Asked
  // to start at exactly currentTime, it can land a few ms in the past (that
  // clock reading goes stale while the page is busy, e.g. Othello's bot
  // thinking) and then starts partway into its 9ms shape -- the soft start
  // cut off, so the same click sounded sharper or thinner now and then.
  var LOOKAHEAD = 0.015;
  var CLICK_HZ = 1075;
  var CLICK_LEVEL = 0.28 * 0.45;

  function play(name){
    var isClick = name === 'click';
    debug(name + ': audio ' + (ctx ? ctx.state : 'none') +
      (isClick || buffers[name] ? '' : ', NOT LOADED') + (isMuted() ? ', MUTED' : ''));
    if (!ctx || isMuted()) return;
    if (!isClick) { playFile(name); return; }
    unlock();
    try {
      var t = ctx.currentTime + LOOKAHEAD;
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(CLICK_LEVEL, t + 0.001);
      gain.gain.setValueAtTime(CLICK_LEVEL, t + 0.005);
      gain.gain.linearRampToValueAtTime(0, t + 0.0095);
      gain.connect(ctx.destination);
      var src = ctx.createOscillator();
      src.type = 'sine';
      src.frequency.value = CLICK_HZ;
      src.connect(gain);
      src.start(t);
      src.stop(t + 0.012);
      // Asked for while iOS still has the page locked: it would sit queued
      // and burst out on the next real tap (Number Puzzle's sounds
      // playing when Back was pressed). Keep it only if the unlock lands
      // right away, as it does when this tap itself is the unlocking one.
      if (ctx.state !== 'running') pending.push({ src: src, at: performance.now() });
    } catch (e) {}
  }
  function playFile(name){
    if (!buffers[name]) return;
    unlock();
    try {
      var src = ctx.createBufferSource();
      src.buffer = buffers[name];
      if (VOLUME[name] != null) {
        var level = ctx.createGain();
        level.gain.value = VOLUME[name];
        src.connect(level);
        level.connect(ctx.destination);
      } else {
        src.connect(ctx.destination);
      }
      src.start(0);
      if (ctx.state !== 'running') pending.push({ src: src, at: performance.now() });
    } catch (e) {}
  }
  var pending = [];
  // Generous: on an iPhone the first tap's unlock can take a good fraction
  // of a second to get audio running, and that tap's own click must survive
  // it. Only sounds left over from long before (drag-only play) are dropped.
  var STALE_MS = 1000;
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
  // If this tap is the page's first, audio is still starting up (it can take
  // several hundred ms on an iPhone) -- wait for it to be running before
  // counting the delay, or the page changes before the click ever sounds.
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
  var TONE_LEVEL = 0.3 * 0.35; // 35% of the tones' original level
  function tone(i){
    // Not queued while iOS still has the page locked -- a pattern's notes
    // only make sense in time with the pads lighting up.
    if (!ctx || isMuted() || ctx.state !== 'running') { debug('tone ' + i + ': skipped'); return; }
    var f = TONE_HZ[i % TONE_HZ.length];
    var t = ctx.currentTime + LOOKAHEAD;
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
