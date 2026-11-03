const APP_NAME = 'AllFantasy';
const CACHE_VER = 'v1.0.8';
const CACHE_STATIC = `${APP_NAME}-static-${CACHE_VER}`;
const CACHE_PAGES = `${APP_NAME}-pages-${CACHE_VER}`;
const CACHE_IMAGES = `${APP_NAME}-images-${CACHE_VER}`;
/*
 * Lineup snapshots written BY THE PAGE (lib/pwa/offlineLineupSnapshots.ts), read here to build the
 * offline fallback. Unversioned on purpose and listed in ALL_CACHES, or `activate` would delete the
 * reader's saved lineups on every worker update. The `-pages-` prefix is what sign-out purges.
 * Must equal OFFLINE_LINEUP_CACHE there; __tests__/pwa-offline-lineups.test.ts pins the two.
 */
const CACHE_OFFLINE_LINEUPS = `${APP_NAME}-pages-offline-lineups`;
const ALL_CACHES = [CACHE_STATIC, CACHE_PAGES, CACHE_IMAGES, CACHE_OFFLINE_LINEUPS];

/*
 * ⚠ EVERY ENTRY HERE IS FETCHED ON EVERY INSTALL, AND THREE OF THE ORIGINAL
 * SEVEN WERE STALE. Measured by running `cache.add` on each against production
 * rather than reasoning about it, because the interesting one does not fail:
 *
 *   /app/home    REJECTED — 404. The route went away when /app became /core.
 *   /favicon.ico REJECTED — 404. This app declares its icons in layout
 *                metadata and ships no .ico at all.
 *   /app         CACHED a redirected login page under the old app URL.
 *
 * The install handler wraps each add in its own catch, so the two rejections
 * were console warnings rather than a broken install — which is exactly why all
 * three survived a rename of the whole app shell. They are dropped, not
 * repointed.
 *
 * Only public offline/static resources are pre-cached. App HTML is always
 * fetched fresh because a redirect may lead to a VPN block or sign-in page.
 */
const PRECACHE_ASSETS = [
  '/offline',
  '/manifest.webmanifest',
  '/af-crest-transparent.png',
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

  // RSC and other dynamic GET responses can carry a VPN refusal, auth state,
  // or private data. Let the browser fetch them directly without SW storage.
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

async function networkFirstWithOfflineFallback(event) {
  const { request } = event;

  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) return preloadResponse;
  } catch {
    // Fall through to network fetch
  }

  try {
    // Navigation HTML can contain a VPN block, login, or user data after a
    // redirect. Never persist it under the original app URL: on iOS a failed
    // launch could otherwise replay that page after the VPN is disconnected.
    return await fetch(request);
  } catch {
    const lineups = await offlineLineupsPage();
    if (lineups) return lineups;
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

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/*
 * The offline fallback when the reader has saved lineups: built here from the snapshots, so it needs
 * no cached page and no app JavaScript, and works on a cold launch with no network at all. Every
 * value is escaped — names come from provider data, and this HTML is not rendered by React.
 *
 * Returns null (so the caller falls back to /offline) when there is nothing usable or anything at
 * all goes wrong: a broken offline page is worse than the plain one.
 */
async function offlineLineupsPage() {
  try {
    const cache = await caches.open(CACHE_OFFLINE_LINEUPS);
    const keys = await cache.keys();
    const snapshots = [];
    for (const key of keys) {
      // Same cache also holds the lineup editor's data and queued offline edits; only snapshots render here.
      if (!new URL(key.url).pathname.startsWith('/__offline/lineups/')) continue;
      try {
        const res = await cache.match(key);
        const s = res ? await res.json() : null;
        if (s && s.v === 1 && Array.isArray(s.starters) && Array.isArray(s.bench)) snapshots.push(s);
      } catch {
        // skip one unreadable record, keep the rest
      }
    }
    if (!snapshots.length) return null;
    snapshots.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

    const rows = (label, list) => (Array.isArray(list) && list.length ? `
      <h3>${escapeHtml(label)}</h3>
      <ul>${list.map((r) => `
        <li><span class="pill">${escapeHtml(r.slot)}</span><span class="who">${r.name
          ? `<strong>${escapeHtml(r.name)}${r.injury && !/^(healthy|active|none)$/i.test(r.injury) ? ` <em>${escapeHtml(r.injury)}</em>` : ''}</strong><small>${escapeHtml([r.position, r.team, r.game].filter(Boolean).join(' · '))}</small>`
          : '<small>Empty</small>'}</span></li>`).join('')}
      </ul>` : '');

    const cards = snapshots.map((s) => {
      const d = new Date(s.savedAt);
      const when = Number.isFinite(d.getTime())
        ? d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
        : 'an unknown time';
      return `
      <section class="card">
        <p class="eyebrow">${escapeHtml(s.leagueName)}${s.week ? ` · Week ${escapeHtml(s.week)}` : ''}</p>
        <h2>${escapeHtml(s.teamName)}</h2>
        <p class="age">Last updated ${escapeHtml(when)}</p>
        ${rows('Starters', s.starters)}${rows('Bench', s.bench)}${rows('Injured reserve', s.ir)}${rows('Taxi squad', s.taxi)}
      </section>`;
    }).join('');

    return new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Offline lineups - AllFantasy</title>
      <style>
        body{margin:0;background:#020617;color:#fff;font-family:system-ui,sans-serif;padding:16px}
        main{max-width:640px;margin:0 auto}
        .bar{display:flex;gap:12px;align-items:center;justify-content:space-between;background:#1e293b;border-radius:12px;padding:12px 14px;margin-bottom:16px}
        .bar p{margin:0;color:rgba(255,255,255,.75);font-size:14px}
        button{padding:10px 18px;background:#06b6d4;border:none;border-radius:8px;color:#000;font-weight:700;font-size:14px;cursor:pointer;flex:none}
        .card{background:#0f172a;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin-bottom:16px}
        .eyebrow{margin:0;color:rgba(255,255,255,.55);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
        h2{margin:4px 0 2px;font-size:20px} .age{margin:0 0 8px;color:#fbbf24;font-size:13px}
        h3{margin:14px 0 6px;font-size:12px;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.05em}
        ul{list-style:none;margin:0;padding:0}
        li{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.06)}
        .pill{min-width:44px;text-align:center;font-size:12px;font-weight:700;background:rgba(6,182,212,.15);color:#67e8f9;border-radius:6px;padding:3px 6px}
        .who{display:flex;flex-direction:column;min-width:0} small{color:rgba(255,255,255,.55);font-size:12px}
        em{font-style:normal;color:#f87171;font-size:12px}
      </style></head>
      <body><main>
        <div class="bar"><p>You're offline. These are your lineups from your last visit. Changes are off until you reconnect.</p>
          <button onclick="location.reload()">Retry</button></div>
        ${cards}
      </main>
      <script>window.addEventListener('online',function(){location.reload()})</script>
      </body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: APP_NAME, body: event.data.text() };
  }

  // Delivery can lag provider acceptance. Never display an expired game update.
  if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) return;

  const options = {
    body: payload.body || 'You have a new update.',
    icon: payload.icon || '/af-crest-transparent.png',
    badge: payload.badge || '/af-crest-transparent.png',
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
  const { type } = event.data || {};

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

/*
 * ---------------------------------------------------------------------------
 * Windows Widgets (the `widgets` entry in manifest.webmanifest)
 * ---------------------------------------------------------------------------
 *
 * ⚠ THE MANIFEST ENTRY IS ONE THIRD OF A WIDGET. Declaring `widgets` without
 * these handlers gets the widget INSTALLED and then left permanently blank —
 * the OS has a template and a data URL but nothing ever calls
 * `widgets.updateByInstanceId`, so nothing renders. That fails silently and
 * looks like a broken app rather than a missing feature. The three pieces are:
 *
 *   manifest.webmanifest        declares tag / template / data
 *   public/widgets/<tag>.ac.json     the Adaptive Card
 *   app/api/widgets/<tag>/route.ts   the data the card binds to
 *
 * Ship them together or not at all.
 *
 * `self.widgets` exists only on user agents that implement the Widgets API
 * (Windows 11 via Edge today). Every handler below is registered behind a
 * feature check so this file stays valid on every other browser, where these
 * events simply never fire.
 */

async function renderWidget(widget) {
  if (!widget?.definition) return;

  try {
    const [templateRes, dataRes] = await Promise.all([
      fetch(widget.definition.msAcTemplate),
      fetch(widget.definition.data),
    ]);

    /*
     * Read the status rather than trusting the promise resolving. `fetch` only
     * rejects on a network error — a 404 on the template resolves happily and
     * would hand the host the string "<!DOCTYPE html>..." to parse as an
     * Adaptive Card. This repo has the same lesson written down twice already:
     * a check that cannot fail reads as a pass.
     */
    if (!templateRes.ok || !dataRes.ok) {
      console.warn(
        `[${APP_NAME} SW] Widget assets unavailable:`,
        `template=${templateRes.status}`,
        `data=${dataRes.status}`
      );
      return;
    }

    const [template, data] = await Promise.all([templateRes.text(), dataRes.text()]);
    await self.widgets.updateByInstanceId(widget.instanceId, { template, data });
  } catch (err) {
    console.warn(`[${APP_NAME} SW] Widget render failed:`, err?.message ?? err);
  }
}

if ('widgets' in self) {
  self.addEventListener('widgetinstall', (event) => {
    event.waitUntil(renderWidget(event.widget));
  });

  // Fires when the host wakes a widget that was already installed.
  self.addEventListener('widgetresume', (event) => {
    event.waitUntil(renderWidget(event.widget));
  });

  /*
   * Nothing is persisted per widget instance — the card is rebuilt from the
   * template and the endpoint every time — so there is nothing to tear down.
   * The handler is still registered: without it the host has no acknowledgement
   * that the uninstall was received.
   */
  self.addEventListener('widgetuninstall', (event) => {
    console.log(`[${APP_NAME} SW] Widget uninstalled: ${event.widget?.definition?.tag}`);
  });

  /*
   * Only CUSTOM verbs reach here. Every action on this card is an
   * Action.OpenUrl, which the host opens itself — so this fires for nothing
   * today and exists so a future verb cannot be added without a handler.
   */
  self.addEventListener('widgetclick', (event) => {
    if (event.action) {
      console.log(`[${APP_NAME} SW] Widget action: ${event.action}`);
    }
  });
}
