const APP_NAME = 'AllFantasy';
const CACHE_VER = 'v1.0.6';
const CACHE_STATIC = `${APP_NAME}-static-${CACHE_VER}`;
const CACHE_PAGES = `${APP_NAME}-pages-${CACHE_VER}`;
const CACHE_IMAGES = `${APP_NAME}-images-${CACHE_VER}`;
const ALL_CACHES = [CACHE_STATIC, CACHE_PAGES, CACHE_IMAGES];

/*
 * ⚠ EVERY ENTRY HERE IS FETCHED ON EVERY INSTALL, AND THREE OF THE ORIGINAL
 * SEVEN WERE STALE. Measured by running `cache.add` on each against production
 * rather than reasoning about it, because the interesting one does not fail:
 *
 *   /app/home    REJECTED — 404. The route went away when /app became /core.
 *   /favicon.ico REJECTED — 404. This app declares its icons in layout
 *                metadata and ships no .ico at all.
 *   /app         CACHED, and that is the bad one. cache.add FOLLOWS redirects,
 *                so /app 307s to /core, /core 307s to /login, and the LOGIN
 *                PAGE gets stored under the /app key (status 200,
 *                redirected=true). `/^\/app/` is in NETWORK_FIRST_PATTERNS
 *                below, so an offline hit on any /app* URL served that login
 *                HTML back as if it were the app shell.
 *
 * The install handler wraps each add in its own catch, so the two rejections
 * were console warnings rather than a broken install — which is exactly why all
 * three survived a rename of the whole app shell. They are dropped, not
 * repointed.
 *
 * `/login` is added because it is where an offline launch actually lands:
 * start_url is /core, and /core 307s to /login for anyone not signed in.
 */
const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/offline',
  '/manifest.webmanifest',
  '/af-crest.png',
];

const NEVER_CACHE = [
  '/api/',
  '/admin',
  '/_next/webpack',
];

const CACHE_FIRST_PATTERNS = [
  /\/_next\/static\//,
  /\/icons\//,
  /\/branding\//,
  /\.(?:png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|otf)$/i,
];

const NETWORK_FIRST_PATTERNS = [
  /^\/$/,
  /^\/app/,
  /^\/news/,
  /^\/trade/,
  /^\/waiver/,
  /^\/draft/,
];

self.addEventListener('install', (event) => {
  console.log(`[${APP_NAME} SW] Installing ${CACHE_VER}`);

  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => {
        console.log(`[${APP_NAME} SW] Pre-caching ${PRECACHE_ASSETS.length} assets`);
        return Promise.allSettled(
          PRECACHE_ASSETS.map((url) =>
            cache.add(url).catch((err) =>
              console.warn(`[${APP_NAME} SW] Pre-cache miss: ${url}`, err?.message ?? err)
            )
          )
        );
      })
      .then(() => {
        console.log(`[${APP_NAME} SW] Install complete`);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log(`[${APP_NAME} SW] Activating ${CACHE_VER}`);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        const stale = cacheNames.filter(
          (name) => name.startsWith(APP_NAME) && !ALL_CACHES.includes(name)
        );
        if (stale.length) {
          console.log(`[${APP_NAME} SW] Removing stale caches:`, stale);
        }
        return Promise.all(stale.map((name) => caches.delete(name)));
      })
      .then(async () => {
        console.log(`[${APP_NAME} SW] Active - claiming all clients`);
        await self.clients.claim();
        if ('navigationPreload' in self.registration) {
          await self.registration.navigationPreload.enable();
          console.log(`[${APP_NAME} SW] Navigation preload enabled`);
        }
      })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((path) => url.pathname.startsWith(path))) {
    // For navigation requests (e.g. /api/auth/callback/google after OAuth):
    // when Navigation Preload is enabled, Chrome has already fired a preload HTTP
    // request. If the SW returns early without calling event.respondWith(), Chrome
    // also sends a fallback network fetch — resulting in TWO simultaneous requests
    // to the same URL. OAuth authorization codes are single-use; whichever request
    // arrives second gets an invalid_grant error from Google → OAuthCallbackError.
    // Fix: consume the preload response (or fall back to one fetch) so Chrome never
    // sends the duplicate fallback request.
    if (request.mode === 'navigate') {
      event.respondWith(
        Promise.resolve(event.preloadResponse)
          .then((r) => r || fetch(request))
          .catch(() => fetch(request))
      );
    }
    return;
  }

  if (CACHE_FIRST_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(event));
    return;
  }

  if (NETWORK_FIRST_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(networkFirst(request, CACHE_PAGES));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, CACHE_PAGES));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Asset unavailable offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline - content unavailable', { status: 503 });
  }
}

async function networkFirstWithOfflineFallback(event) {
  const { request } = event;

  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) {
      if (preloadResponse.ok) {
        const cache = await caches.open(CACHE_PAGES);
        cache.put(request, preloadResponse.clone());
      }
      return preloadResponse;
    }
  } catch {
    // Fall through to network fetch
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_PAGES);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const home = await caches.match('/');
    if (home) return home;

    const offline = await caches.match('/offline');
    return offline || new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline - AllFantasy</title></head>
       <body style="background:#020617;color:white;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:12px">
         <h1>You're offline</h1>
         <p style="color:rgba(255,255,255,.55)">Check your connection and reload.</p>
         <button onclick="location.reload()" style="padding:10px 24px;background:#06b6d4;border:none;border-radius:8px;color:#000;font-weight:700;cursor:pointer;font-size:14px">Retry</button>
       </body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        const forCache = response.clone();
        caches.open(cacheName).then((cache) => cache.put(request, forCache));
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const networkResponse = await fetchPromise;
  return networkResponse || new Response('Offline - content unavailable', { status: 503 });
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: APP_NAME, body: event.data.text() };
  }

  const options = {
    body: payload.body || 'You have a new update.',
    icon: payload.icon || '/af-crest.png',
    badge: payload.badge || '/af-crest.png',
    image: payload.image || undefined,
    tag: payload.tag || 'af-notification',
    renotify: payload.renotify ?? false,
    silent: payload.silent ?? false,
    data: {
      url: payload.url || '/app',
      leagueId: payload.leagueId || null,
      type: payload.type || 'general',
    },
    actions: buildNotificationActions(payload.type),
    timestamp: Date.now(),
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || APP_NAME, options)
  );
});

function buildNotificationActions(type) {
  switch (type) {
    case 'trade':
      return [{ action: 'view', title: 'View Trade' }, { action: 'dismiss', title: 'Dismiss' }];
    case 'waiver':
      return [{ action: 'view', title: 'View Waivers' }, { action: 'dismiss', title: 'Dismiss' }];
    case 'draft':
      return [{ action: 'join', title: 'Join Draft' }, { action: 'dismiss', title: 'Dismiss' }];
    case 'score':
      return [{ action: 'view', title: 'View Scores' }, { action: 'dismiss', title: 'Dismiss' }];
    default:
      return [{ action: 'open', title: 'Open App' }];
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action } = event;
  const { url, leagueId, type } = event.notification.data;

  let targetUrl = url || '/app';

  if (action === 'dismiss') return;
  if (action === 'join' && type === 'draft') targetUrl = leagueId ? `/league/${leagueId}/draft` : '/app';
  if (action === 'view' && type === 'trade') targetUrl = leagueId ? `/app/league/${leagueId}/trades` : '/app';
  if (action === 'view' && type === 'waiver') targetUrl = '/waiver-wire';
  if (action === 'view' && type === 'score') targetUrl = leagueId ? `/app/league/${leagueId}/scores` : '/app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            if ('navigate' in client) {
              client.navigate(targetUrl);
            }
            return;
          }
        }
        return clients.openWindow(targetUrl);
      })
  );
});

self.addEventListener('notificationclose', (event) => {
  const { type } = event.notification.data;
  console.log(`[${APP_NAME} SW] Notification dismissed - type: ${type}`);
});

self.addEventListener('sync', (event) => {
  console.log(`[${APP_NAME} SW] Background sync: ${event.tag}`);

  if (event.tag === 'af-sync-trades') {
    event.waitUntil(syncPendingTrades());
  }
  if (event.tag === 'af-sync-waivers') {
    event.waitUntil(syncPendingWaivers());
  }
});

async function syncPendingTrades() {
  console.log(`[${APP_NAME} SW] Syncing pending trades`);
}

async function syncPendingWaivers() {
  console.log(`[${APP_NAME} SW] Syncing pending waiver claims`);
}

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      console.log(`[${APP_NAME} SW] SKIP_WAITING received`);
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .then(() => {
            console.log(`[${APP_NAME} SW] All caches cleared`);
            event.source?.postMessage?.({ type: 'CACHE_CLEARED' });
          })
      );
      break;

    case 'GET_CACHE_STATS':
      event.waitUntil(
        Promise.all(
          ALL_CACHES.map(async (name) => {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            return { name, count: keys.length };
          })
        ).then((stats) => {
          event.source?.postMessage?.({ type: 'CACHE_STATS', payload: stats });
        })
      );
      break;

    case 'PRECACHE_URL':
      if (payload?.url) {
        event.waitUntil(
          caches.open(CACHE_PAGES).then((cache) => cache.add(payload.url))
        );
      }
      break;

    default:
      console.log(`[${APP_NAME} SW] Unknown message type: ${type}`);
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'af-refresh-feed') {
    event.waitUntil(refreshSportsFeed());
  }
});

async function refreshSportsFeed() {
  try {
    const response = await fetch('/api/feed?sports=NFL,NBA,NCAA&limit=20');
    if (response.ok) {
      const cache = await caches.open(CACHE_PAGES);
      await cache.put('/api/feed?sports=NFL,NBA,NCAA&limit=20', response);
      console.log(`[${APP_NAME} SW] Sports feed refreshed in background`);
    }
  } catch (err) {
    console.warn(`[${APP_NAME} SW] Background feed refresh failed:`, err?.message ?? err);
  }
}

console.log(`[${APP_NAME} SW] Script loaded - ${CACHE_VER}`);
