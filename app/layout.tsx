import type { Metadata } from 'next';
import type { Session } from 'next-auth';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { AppProviders } from '@/components/providers/AppProviders';
import { SpotifyMiniPlayer } from '@/components/spotify/SpotifyMiniPlayer';
import { FloatingMusicWidget } from '@/components/MusicWidget';
import { DefaultJsonLd } from '@/components/seo/JsonLd';
import { SafeGlobalChrome } from '@/components/shell/SafeGlobalChrome';
import { MetaPixelPageViewTracker } from '@/components/meta/MetaPixelPageViewTracker';
import { ErrorBoundaryClient } from '@/components/error-handling/ErrorBoundaryClient';
import { PlayerComparisonUIProvider } from '@/components/player-comparison-ui';
import { buildSeoMeta } from '@/lib/seo';
import { resolveEffectiveDataMode } from '@/lib/theme';
import { getLanguageTextDirection, resolveLanguage } from '@/lib/i18n/constants';
import './globals.css';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover' as const,
};

const useExperimentalManifest = process.env.NEXT_PUBLIC_PWA_EXPERIMENTAL_MANIFEST === '1';
const metadataManifestPath = useExperimentalManifest
  ? '/manifest.experimental.webmanifest'
  : '/manifest.webmanifest';
export const metadata: Metadata = {
  ...buildSeoMeta({
    title: 'AllFantasy – Fantasy Sports Tools Powered by Chimmy',
    description:
      'AllFantasy combines fantasy sports leagues, bracket challenges, and Chimmy-powered tools to help players draft smarter, analyze trades, and dominate their leagues.',
    canonical: 'https://allfantasy.ai/',
    keywords: [
      'fantasy sports',
      'fantasy football tools',
      'fantasy trade analyzer',
      'fantasy sports assistant',
      'fantasy bracket challenge',
    ],
  }),
  icons: {
    icon: [
      { url: '/af-crest.png', type: 'image/png' },
    ],
    apple: '/af-crest.png',
  },
  manifest: metadataManifestPath,
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'mobile-web-app-capable': 'yes',
    'format-detection': 'telephone=no',
  },
};

/**
 * Root layout — Railway-safe.
 *
 * The previous implementation gated head/body chrome on the middleware-
 * injected `x-af-pathname` header. Railway's upstream proxy can strip that
 * header, which made the server render full app chrome on `/login` while the
 * client (which always knows the pathname via `usePathname()`) rendered the
 * auth shell — producing React #418/#423, HierarchyRequestError, and
 * NotFoundError on hydration.
 *
 * Fix: render a single, route-agnostic root document, and delegate every
 * piece of route-sensitive chrome (PWA service-worker lifecycle, Meta Pixel,
 * Facebook SDK, AuthRouteGlobalChrome with its toaster / back-to-top / mode
 * toggle / etc.) to `<SafeGlobalChrome />`, a client component that bails on
 * auth routes via `usePathname()`. Server and client now produce identical
 * HTML on every route regardless of which headers the upstream proxy keeps.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get('af_lang')?.value;
  const htmlLang = resolveLanguage(cookieLang);
  const htmlDir = getLanguageTextDirection(htmlLang);
  const cookieMode = cookieStore.get('af_mode')?.value;
  const htmlMode = resolveEffectiveDataMode(cookieMode);

  // Always attempt to preload the session. `getServerSession` only reads the
  // NextAuth JWT from cookies, so it is safe and cheap on auth routes
  // (returns null when there is no session). Wrapped in try/catch so a
  // NextAuth misconfiguration cannot crash the document shell.
  let initialSession: Session | null = null;
  try {
    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import('next-auth'),
      import('@/lib/auth'),
    ]);
    initialSession = (await getServerSession(authOptions as never)) as Session | null;
  } catch (error) {
    if (process.env.PLAYWRIGHT_E2E === '1') {
      console.warn('[layout] failed to preload session for Playwright E2E:', error);
    }
  }

  // Phase V1.1: `PLAYWRIGHT_E2E` already exists (see the try/catch above) as this codebase's own signal
  // for "this is an automated, non-production run." Reusing it here — rather than inventing a new flag
  // — to suppress third-party ad-tracking scripts (Meta Pixel, GTM/gtag, Google Ads conversion) ONLY
  // when explicitly opted into via a dedicated `.claude/launch.json` config (`next-dev-visual-qa`).
  // Unset in normal local dev and always unset in production, so default analytics behavior is
  // unchanged. Root cause: these scripts fire unconditionally whenever their env vars are populated,
  // including under `next dev`, and their volume of outbound network calls was saturating the browser
  // automation tooling used for Visual OS screenshot capture (docs/os/VISUAL_OS_V1_FOUNDATION.md).
  const isVisualQaMode = process.env.PLAYWRIGHT_E2E === '1';
  const gaMeasurementId = isVisualQaMode ? '' : process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';
  const metaPixelId = isVisualQaMode ? '' : process.env.NEXT_PUBLIC_META_PIXEL_ID || '';
  const fbAppId = isVisualQaMode ? '' : process.env.NEXT_PUBLIC_FB_APP_ID || '1790659191546539';
  return (
    <html
      lang={htmlLang}
      data-lang={htmlLang}
      dir={htmlDir}
      data-mode={htmlMode}
      className="scroll-smooth"
      suppressHydrationWarning
    >
      <body
        className="antialiased min-h-screen mode-readable"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >

        {/*
          The core-app design handoff's two typefaces. Every .af-core surface
          asks for Archivo and JetBrains Mono by name, and nothing was loading
          them, so all of it fell through to system-ui and generic monospace —
          the display headings and the mono labels are most of that design's
          character, and none of it was reaching a user.

          Loaded here rather than from af-core.css because an @import inside a
          route-bundled CSS file is dropped whenever another af-*.css is
          concatenated ahead of it (measured: af-geo.css was). A <link> here is
          the one place stylesheet ordering is guaranteed.

          Global, but inert for every page that does not name these families:
          the browser fetches the small stylesheet and downloads a font file
          only when matching text is actually rendered. Weights are exactly the
          handoff's — Archivo 400/600/700/800/900, JetBrains Mono 400/500/700/800.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;500;700;800&display=swap"
        />

        {metaPixelId ? (
          <script
            id="meta-pixel-immediate-bootstrap"
            dangerouslySetInnerHTML={{
              __html: `
                (function(f,b,e,v,pixelId,n,t,s) {
                  if (!pixelId) return;
                  if (typeof f.fbq !== 'function') {
                    n=f.fbq=function(){n.callMethod?
                    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                    n.queue=[];t=b.createElement(e);t.async=!0;
                    t.onload=function(){f.__afMetaFbeventsLoaded=!0};
                    t.onerror=function(){f.__afMetaFbeventsLoaded=!1};
                    t.src=v;s=b.getElementsByTagName(e)[0];
                    if (s && s.parentNode) {
                      s.parentNode.insertBefore(t,s);
                    } else {
                      (b.head || b.body || b.documentElement).appendChild(t);
                    }
                  }
                  f.__afMetaPixelId=pixelId;
                  f.__afMetaPixelIds=f.__afMetaPixelIds instanceof Set
                    ? f.__afMetaPixelIds
                    : new Set();
                  if(!f.__afMetaPixelIds.has(pixelId)) {
                    f.fbq('init', pixelId);
                    f.__afMetaPixelIds.add(pixelId);
                  }
                  if(!f.__afMetaBasePageViewFired) {
                    f.__afMetaBasePageViewEventId=f.__afMetaBasePageViewEventId||('af_PageView_bootstrap_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10));
                    f.fbq('track', 'PageView', {
                      content_name: b.title || 'PageView',
                      content_category: 'Page',
                      page_path: f.location.pathname,
                      value: 0,
                      currency: 'USD'
                    }, {eventID: f.__afMetaBasePageViewEventId});
                    f.__afMetaBasePageViewFired=!0;
                  }
                  try {
                    if (new URLSearchParams(f.location.search).get('af_debug_meta') === '1') {
                      setTimeout(function() {
                        var script = b.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]');
                        console.info('[AF Meta] NEXT_PUBLIC_META_PIXEL_ID value', pixelId);
                        console.info('[AF Meta] typeof window.fbq', typeof f.fbq);
                        console.info('[AF Meta] fbevents.js loaded', f.__afMetaFbeventsLoaded === true || Boolean(script && f.fbq && f.fbq.callMethod));
                      }, 1500);
                    }
                  } catch (err) {}
                })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js', ${JSON.stringify(metaPixelId)});
              `,
            }}
          />
        ) : null}

        {metaPixelId ? (
          <Script id="meta-pixel-base" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.onload=function(){f.__afMetaFbeventsLoaded=!0};
              t.onerror=function(){f.__afMetaFbeventsLoaded=!1};
              t.src=v;s=b.getElementsByTagName(e)[0];
              if (s && s.parentNode) {
                s.parentNode.insertBefore(t,s);
              } else {
                (b.head || b.body || b.documentElement).appendChild(t);
              }}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              window.__afMetaPixelId=${JSON.stringify(metaPixelId)};
              window.__afMetaPixelIds = window.__afMetaPixelIds instanceof Set
                ? window.__afMetaPixelIds
                : new Set();
              if (!window.__afMetaPixelIds.has(${JSON.stringify(metaPixelId)})) {
                fbq('init', ${JSON.stringify(metaPixelId)});
                window.__afMetaPixelIds.add(${JSON.stringify(metaPixelId)});
              }
              if (!window.__afMetaBasePageViewFired) {
                window.__afMetaBasePageViewEventId = window.__afMetaBasePageViewEventId || ('af_PageView_bootstrap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10));
                fbq('track', 'PageView', {
                  content_name: document.title || 'PageView',
                  content_category: 'Page',
                  page_path: window.location.pathname,
                  value: 0,
                  currency: 'USD'
                }, { eventID: window.__afMetaBasePageViewEventId });
                window.__afMetaBasePageViewFired = true;
              }

              (function() {
                function shouldDebug() {
                  try {
                    return new URLSearchParams(window.location.search).get('af_debug_meta') === '1';
                  } catch (err) {
                    return false;
                  }
                }
                if (!shouldDebug()) return;
                setTimeout(function() {
                  var script = document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]');
                  console.info('[AF Meta] NEXT_PUBLIC_META_PIXEL_ID value', ${JSON.stringify(metaPixelId)});
                  console.info('[AF Meta] typeof window.fbq', typeof window.fbq);
                  console.info('[AF Meta] fbevents.js loaded', window.__afMetaFbeventsLoaded === true || Boolean(script && window.fbq && window.fbq.callMethod));
                }, 1500);
              })();
            `}
          </Script>
        ) : null}

        {metaPixelId ? (
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              height="1"
              width="1"
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${encodeURIComponent(metaPixelId)}&ev=PageView&noscript=1`}
            />
          </noscript>
        ) : null}

        {gaMeasurementId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script id="google-gtag" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){window.dataLayer.push(arguments);}
                window.gtag = window.gtag || gtag;
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}', { send_page_view: true });
                gtag('config', 'AW-17768764414');
              `}
            </Script>
          </>
        )}

        <DefaultJsonLd />
        <Script id="analytics-healthcheck" strategy="afterInteractive">
          {`
            (function() {
              try {
                var shouldDebug =
                  window.location.search.indexOf('af_debug_analytics=1') !== -1 ||
                  localStorage.getItem('af_debug_analytics') === '1';

                if (!shouldDebug) return;

                setTimeout(function() {
                  var hasDataLayer = Array.isArray(window.dataLayer);
                  var hasGtag = typeof window.gtag === 'function';

                  console.group('[AF Analytics Health]');
                  console.info('GA Measurement ID:', '${gaMeasurementId}');
                  console.info('window.gtag ready:', hasGtag);
                  console.info('window.dataLayer ready:', hasDataLayer);
                  console.info('dataLayer length:', hasDataLayer ? window.dataLayer.length : 0);

                  try {
                    if (hasGtag) {
                      window.gtag('event', 'af_analytics_healthcheck', {
                        page_path: window.location.pathname,
                        debug_mode: true,
                      });
                      console.info('Sent test event: af_analytics_healthcheck');
                    } else {
                      console.warn('gtag not ready; test event not sent');
                    }
                  } catch (err) {
                    console.warn('Failed to send test event', err);
                  }

                  fetch('/api/analytics/debug', { cache: 'no-store' })
                    .then(function(r){ return r.json(); })
                    .then(function(data){ console.info('/api/analytics/debug =>', data); })
                    .catch(function(err){ console.warn('Debug endpoint failed', err); })
                    .finally(function(){ console.groupEnd(); });
                }, 1500);
              } catch (e) {
                console.warn('[AF Analytics Health] init failed', e);
              }
            })();
          `}
        </Script>
        <AppProviders session={initialSession}>
          <ErrorBoundaryClient>
            <PlayerComparisonUIProvider>{children}</PlayerComparisonUIProvider>
          </ErrorBoundaryClient>

          {/*
            All route-sensitive global chrome lives inside SafeGlobalChrome,
            which uses `usePathname()` to return null on `/login`, `/signup`,
            `/signin`, and `/auth/*`. Because `usePathname()` is reliable on
            both server and client, the SSR output and the hydrated output
            match on every route \u2014 even when an upstream proxy strips the
            middleware-injected `x-af-pathname` request header.
          */}
          {/*
            SafeGlobalChrome is outside the main ErrorBoundaryClient so that a
            chrome crash (Toaster portal, SW registration, etc.) cannot blank the
            page. fallback={null} means a crash hides the chrome widget silently
            rather than replacing it with an amber error UI.
          */}
          <ErrorBoundaryClient fallback={null}>
            {isVisualQaMode ? null : <MetaPixelPageViewTracker pixelId={metaPixelId} />}
            <SafeGlobalChrome fbAppId={fbAppId} />
          </ErrorBoundaryClient>

          {/* Music widgets deferred until Spotify Web Playback SDK is integrated.
              Set NEXT_PUBLIC_MUSIC_WIDGET_ENABLED=true to re-enable.
              Current Web API approach has unreliable preview_url playback. */}
          {process.env.NEXT_PUBLIC_MUSIC_WIDGET_ENABLED === 'true' ? (
            <>
              <SpotifyMiniPlayer />
              <FloatingMusicWidget />
            </>
          ) : null}
        </AppProviders>
      </body>
    </html>
  );
}


