/*
  Offline cache for modern iPads.

  Safari on iOS 9 has no Service Worker, so that device keeps using
  clock.appcache. Safari from iOS 14 on has no Application Cache, so it uses
  this file instead. Both mechanisms cache the same single page, and only one of
  them is ever active on a given device.

  Bump CACHE_NAME together with the version in clock.appcache whenever
  index.html changes.
*/

var CACHE_NAME = 'retro-clock-v89';
var ASSETS = ['./', './index.html'].map(function (path) {
  return new URL(path, self.registration.scope).href;
});

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS.map(function (url) {
        return new Request(url, { cache: 'reload' });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        return name.indexOf('retro-clock-v') === 0 && name !== CACHE_NAME ? caches.delete(name) : null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/*
  Cache first, then refresh in the background. The clock must start instantly and
  without a network, and a page that is one launch behind is not a problem here.
*/
self.addEventListener('fetch', function (event) {
  var url;
  if (event.request.method !== 'GET') {
    return;
  }

  url = new URL(event.request.url);
  if (event.request.mode !== 'navigate' && /^\?clock-update=\d+$/.test(url.search) &&
      ASSETS.indexOf(url.origin + url.pathname) !== -1) {
    event.respondWith(refreshClockPage(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var network = fetch(event.request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }

        return response;
      }).catch(function () {
        return cached;
      });

      return cached || network;
    })
  );
});

/* Refresh both entry points before telling the page it can reload. */
function refreshClockPage(request) {
  return fetch(request, { cache: 'reload' }).then(function (response) {
    if (response.status !== 200 || response.type !== 'basic' ||
        !/^text\/html\b/i.test(response.headers.get('Content-Type') || '')) {
      return response;
    }
    return caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(ASSETS.map(function (url) { return cache.put(url, response.clone()); }));
    }).then(function () {
      return new Response(null, { status: 204 });
    }, function () {
      return response;
    });
  });
}
