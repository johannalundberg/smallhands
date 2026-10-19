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
      src.connect(ctx.destination);
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
  var CLICKABLE = 'a[href], button, .tile, .cell, .tap-cell, .pad, .cluster-card, .equation-tap';
  document.addEventListener('click', function(e){
    var el = e.target.closest && e.target.closest(CLICKABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    play('click');
    // Plain same-tab links (hub tiles, "?", About's back arrow): delay the
    // page change like go() does. Modified clicks open new tabs, leave them be.
    if (el.tagName === 'A' && !el.target && !e.defaultPrevented &&
        !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      go(el.href);
    }
  }, true);

  window.PLSound = { play: play, go: go, isMuted: isMuted, setMuted: setMuted };
})();
