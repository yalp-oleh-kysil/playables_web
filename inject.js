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

  // ---- Роздільність: з якою щільністю гра реально малює свій canvas ----
  window.addEventListener('load', function () {
    setTimeout(function () {
      var best = null, bestArea = 0;
      Array.prototype.forEach.call(document.getElementsByTagName('canvas'), function (c) {
        var r = c.getBoundingClientRect();
        if (r.width * r.height > bestArea) { bestArea = r.width * r.height; best = { c: c, r: r }; }
      });
      if (!best || best.r.width < 50) return;
      var dpr = window.devicePixelRatio || 1;
      var ratio = best.c.width / best.r.width;
      var screenPx = Math.round(window.innerWidth * dpr) + '×' + Math.round(window.innerHeight * dpr);
      var game = best.c.width + '×' + best.c.height;
      post('log', ratio >= dpr - 0.05
        ? 'Рендер гри ' + game + ': повна роздільність екрана ✓'
        : 'Рендер гри ' + game + ' (×' + (Math.round(ratio * 10) / 10) + '), екран ' + screenPx + ' (×' + dpr + ')');
    }, 1500);
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
