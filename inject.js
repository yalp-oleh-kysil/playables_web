// Підключається першим у кожен плеєбл: міст у плеєр, перехоплення CTA і стаби рекламних SDK.
(function () {
  if (window.__ppInjected) return;
  window.__ppInjected = true;

  var host = window.parent !== window ? window.parent : window;
  var post = function (type, data) {
    try { host.postMessage({ __pp: 1, type: type, data: data == null ? '' : String(data) }, '*'); } catch (e) {}
  };
  var emulate = true;
  try { emulate = host.__ppEmulate !== false; } catch (e) {}

  // ---- Помилки ----
  window.addEventListener('error', function (e) {
    if (!e.message) return; // помилки завантаження картинок/звуку тут без тексту
    var where = e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '';
    post('error', e.message + where);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    post('error', 'Unhandled promise: ' + (r && r.message ? r.message : r));
  });

  // ---- CTA: будь-який перехід назовні тільки показуємо, нікуди не йдемо ----
  var isExternal = function (href) {
    try {
      var u = new URL(href, location.href);
      if (/^(about|blob|data|javascript):$/.test(u.protocol)) return false;
      return u.origin !== location.origin;
    } catch (e) { return false; }
  };
  window.open = function (url) { post('cta', 'window.open(' + (url || '') + ')'); return null; };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a && (isExternal(a.href) || a.target === '_blank')) { e.preventDefault(); post('cta', a.href); }
  }, true);
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', function (e) {
      if (!e.hashChange && e.cancelable && isExternal(e.destination.url)) {
        e.preventDefault();
        post('cta', e.destination.url);
      }
    });
  }

  // ---- Звук ----
  // Рекламні SDK запускають WebView, де звуку не потрібен тап, тому багато плеєблів не «розблоковують»
  // звук самі (або роблять це на touchstart, який iOS не рахує). Тут перший же тап запускає
  // всі AudioContext гри, а при згортанні звук ставиться на паузу, як у справжній рекламі.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  var contexts = [];
  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Orig = window[name];
    if (typeof Orig !== 'function') return;
    try {
      window[name] = class extends Orig {
        constructor(options) {
          if (options === undefined) super(); else super(options);
          contexts.push(this);
        }
      };
    } catch (e) {}
  });
  var waitingMedia = [];
  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    var el = this, p = origPlay.apply(this, arguments);
    if (p && p.catch) {
      p.catch(function (err) {
        // повторюємо після тапу тільки музику (loop/autoplay), щоб разові звуки не вистрілили пізніше
        if (err && err.name === 'NotAllowedError' && (el.loop || el.autoplay) && waitingMedia.indexOf(el) < 0) waitingMedia.push(el);
      });
    }
    return p;
  };
  var unlock = function () {
    contexts.forEach(function (ctx) {
      if (ctx.state === 'running' || ctx.state === 'closed') return;
      try { ctx.resume(); } catch (e) {}
      try {
        var src = ctx.createBufferSource();   // iOS: звук має реально стартувати всередині жесту
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
      } catch (e) {}
    });
    waitingMedia.splice(0).forEach(function (el) {
      try { var p = origPlay.call(el); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    });
  };
  ['touchend', 'pointerup', 'mouseup', 'click', 'keydown'].forEach(function (type) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  });
  var pausedByUs = [];
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      contexts.forEach(function (ctx) {
        if (ctx.state === 'running') { pausedByUs.push(ctx); try { ctx.suspend(); } catch (e) {} }
      });
    } else {
      pausedByUs.splice(0).forEach(function (ctx) { try { ctx.resume(); } catch (e) {} });
    }
  });

  if (!emulate) return;

  // ---- Емуляція рекламних SDK ----
  var size = function () { return { width: window.innerWidth, height: window.innerHeight }; };
  var position = function () { var s = size(); return { x: 0, y: 0, width: s.width, height: s.height }; };
  var bus = function () {
    var map = {};
    return {
      on: function (e, f) { if (typeof f === 'function') (map[e] = map[e] || []).push(f); },
      off: function (e, f) { if (map[e]) map[e] = f ? map[e].filter(function (x) { return x !== f; }) : []; },
      emit: function (e) {
        var args = Array.prototype.slice.call(arguments, 1);
        (map[e] || []).slice().forEach(function (f) {
          try { f.apply(null, args); } catch (err) { setTimeout(function () { throw err; }); }
        });
      }
    };
  };
  var mb = bus(), db = bus();
  var state = 'loading', viewable = false;

  // MRAID 3.0 — AppLovin, Unity Ads, Moloco, AdColony, Chartboost, Liftoff
  var mraid = {
    getVersion: function () { return '3.0'; },
    getState: function () { return state; },
    getPlacementType: function () { return 'interstitial'; },
    isViewable: function () { return viewable; },
    addEventListener: mb.on,
    removeEventListener: mb.off,
    open: function (url) { post('cta', 'mraid.open(' + (url || '') + ')'); },
    close: function () { post('log', 'mraid.close()'); },
    unload: function () { post('log', 'mraid.unload()'); },
    expand: function () {},
    resize: function () {},
    useCustomClose: function () {},
    playVideo: function (url) { post('log', 'mraid.playVideo(' + (url || '') + ')'); },
    storePicture: function () {},
    createCalendarEvent: function () {},
    supports: function (feature) { return feature === 'inlineVideo'; },
    getMaxSize: size,
    getScreenSize: size,
    getCurrentPosition: position,
    getDefaultPosition: position,
    getExpandProperties: function () { var s = size(); return { width: s.width, height: s.height, useCustomClose: false, isModal: true }; },
    setExpandProperties: function () {},
    getOrientationProperties: function () { return { allowOrientationChange: true, forceOrientation: 'none' }; },
    setOrientationProperties: function () {},
    getResizeProperties: function () { return {}; },
    setResizeProperties: function () {},
    getCurrentAppOrientation: function () {
      return { orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait', locked: false };
    },
    getLocation: function () { return -1; },
    getAudioVolumePercentage: function () { return 100; }
  };
  window.mraid = mraid;

  // ironSource / Unity LevelPlay — DAPI
  window.dapi = {
    isReady: function () { return state !== 'loading'; },
    isViewable: function () { return viewable; },
    getScreenSize: size,
    getAudioVolume: function () { return 100; },
    openStoreUrl: function () { post('cta', 'dapi.openStoreUrl()'); },
    addEventListener: db.on,
    removeEventListener: db.off
  };

  // Meta
  window.FbPlayableAd = { onCTAClick: function () { post('cta', 'FbPlayableAd.onCTAClick()'); } };

  // Google Ads HTML5
  window.ExitApi = { exit: function () { post('cta', 'ExitApi.exit()'); } };

  // Mintegral: плеєбл кличе gameReady/gameEnd/install, SDK у відповідь кличе gameStart
  window.gameReady = function () {
    post('log', 'gameReady()');
    setTimeout(function () { if (typeof window.gameStart === 'function') window.gameStart(); }, 0);
  };
  window.gameEnd = function () { post('log', 'gameEnd()'); };
  window.install = function () { post('cta', 'install()'); };
  // Vungle / Liftoff (parent.postMessage('download')) ловить сам плеєр

  var setViewable = function (v) {
    if (state === 'loading' || v === viewable) return;
    viewable = v;
    mb.emit('viewableChange', v);
    mb.emit('exposureChange', v ? 100 : 0, null, null);
    db.emit('viewableChange', { isViewable: v });
  };

  // Як у справжніх SDK: на момент ready плеєбл уже видимий
  var ready = function () {
    if (state !== 'loading') return;
    state = 'default';
    viewable = !document.hidden;
    mb.emit('ready');
    mb.emit('stateChange', 'default');
    db.emit('ready');
    mb.emit('viewableChange', viewable);
    mb.emit('exposureChange', viewable ? 100 : 0, null, null);
    db.emit('viewableChange', { isViewable: viewable });
    var s = size();
    mb.emit('sizeChange', s.width, s.height);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(ready, 0); });
  } else {
    setTimeout(ready, 0);
  }

  // Згорнули вкладку чи застосунок → плеєбл має поставити гру й звук на паузу
  document.addEventListener('visibilitychange', function () { setViewable(!document.hidden); });

  window.addEventListener('resize', function () {
    var s = size();
    mb.emit('sizeChange', s.width, s.height);
    db.emit('adResized', { width: s.width, height: s.height });
  });
})();
