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

  function unlock(){
    if (ctx && ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
  }
  ['touchend', 'pointerup', 'click', 'keydown'].forEach(function(type){
    document.addEventListener(type, unlock, { capture: true, passive: true });
  });

  function isMuted(){
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }
  function setMuted(muted){
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
  }

  function play(name){
    if (!ctx || !buffers[name] || isMuted()) return;
    unlock();
    try {
      var src = ctx.createBufferSource();
      src.buffer = buffers[name];
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {}
  }

  // One click sound for every tap on something tappable, site-wide, so no page
  // has to wire it per button. 'click' rather than pointerdown so scrolling the
  // hub over its tiles stays silent. Number Puzzle's pieces are dragged, not
  // clicked, so they play their own drag sound from that page instead.
  var CLICKABLE = 'a[href], button, .tile, .cell, .tap-cell, .pad, .cluster-card, .equation-tap';
  document.addEventListener('click', function(e){
    var el = e.target.closest && e.target.closest(CLICKABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    play('click');
  }, true);

  window.PLSound = { play: play, isMuted: isMuted, setMuted: setMuted };
})();
