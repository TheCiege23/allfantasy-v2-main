import { Suspense } from 'react';
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

/*
 * ⚠ THE EXPERIMENTAL BRANCH POINTED AT A FILE THAT HAS NEVER EXISTED. Setting
 * NEXT_PUBLIC_PWA_EXPERIMENTAL_MANIFEST=1 swapped this to
 * `/manifest.experimental.webmanifest`, which is not in `public/`, is generated
 * by no build step, and is referenced nowhere else in the repo — so the flag's
 * only effect was to 404 the manifest link and make the app uninstallable as a
 * PWA. Removed rather than repaired: there is no second manifest to point at.
 */
const metadataManifestPath = '/manifest.webmanifest';
export const metadata: Metadata = {
  ...buildSeoMeta({
    title: 'AllFantasy – Fantasy Sports Tools Powered by Chimmy',
    description:
      'AllFantasy combines fantasy sports leagues, bracket challenges, and Chimmy-powered tools to help players draft smarter, analyze trades, and dominate their leagues.',
    // canonicalPath, not a hardcoded host: the origin resolves through
    // getPublicSiteOrigin like the sitemap does, so the homepage canonical can
    // never name a host that redirects to the other one.
    canonicalPath: '/',
    keywords: [
      'fantasy sports',
      'fantasy football tools',
      'fantasy trade analyzer',
      'fantasy sports assistant',
      'fantasy bracket challenge',
    ],
  }),
  /*
   * ⚠ `/af-crest.png` IS A JPEG WEARING A .png EXTENSION — its magic bytes say
   * so — and it was declared here as `image/png`. Browsers sniff and mostly
   * cope, but iOS is stricter about the apple-touch icon, and that icon is on
   * the path to "Add to Home Screen", which is the only way a user can ever
   * receive a push. The manifest icons beside it are real PNGs at every size,
   * so the honest fix is to point at those rather than re-declare a lie.
   */
  icons: {
    icon: [
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/icons/icon-192.png',
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
  // AF_SKIP_SESSION_PRELOAD=1 removes this call entirely. It is wrapped in a
  // try/catch below, and a try/catch around a dynamic Next API also swallows
  // Next's own internal control-flow exceptions — which would discard the
  // layout's render rather than surfacing an error. It runs before either
  // return path, so the minimal-layout bisect still went through it. Temporary.
  if (process.env.AF_SKIP_SESSION_PRELOAD !== '1') try {
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
  // Gated on isVisualQaMode with the rest of them, for the reason the comment
  // above gives: a GTM container loads whatever tags it holds, so leaving it on
  // under Visual OS capture would reintroduce exactly the outbound-call volume
  // that suppression exists to remove — and more of it than any single pixel.
  const gtmId = isVisualQaMode ? '' : process.env.NEXT_PUBLIC_GTM_ID || '';
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
      {/*
        Deliberately a runtime <link>, not Next's build-time Google-fonts font
        loader: this repo's build has failed for unrelated network/heap reasons
        before, and __tests__/root-language-provider-layout.test.tsx asserts
        the root document does not depend on a build-time Google Fonts fetch
        (it greps this file's source for that loader's import path, so this
        comment deliberately doesn't spell it out either).

        🛑 `precedence` IS LOAD-BEARING, AND THIS COMMENT USED TO SAY THE
        OPPOSITE. It claimed that rendering a bare <link> here was enough
        because "Next's App Router hoists it into the document head on its
        own". Measured on Next 14.2.35 / React 18.3.1, it does not. Without a
        precedence React emits the element exactly where the tree puts it: in
        the served HTML it landed after `</head>` and before `<body>`, which is
        not a legal position for it. Every symptom followed from that one byte
        offset:

          Warning: In HTML, <link> cannot be a child of <html>. This will
                   cause a hydration error.
          Warning: Cannot render a <link rel="stylesheet" /> outside the main
                   document without knowing its precedence.
          Warning: An error occurred during hydration. The server HTML was
                   replaced with client content in #document.

        That last line is the cost: React threw away the WHOLE server-rendered
        document and re-rendered it on the client, on every page — so
        production lost SSR on first paint. The fonts themselves still arrived,
        which is why this went unnoticed for so long: the browser's parser
        silently relocates a stray <link> into the head while building the DOM,
        so the page looked right. Measured before this change, the document
        carried TWO copies of this stylesheet — the parser's rescued one, plus
        the one React appended under <html> during its client re-render. Both
        of those are gone now.

        With a precedence React treats the element as a stylesheet RESOURCE and
        hoists it for real; it is emitted inside the head with a
        `data-precedence` attribute, like the two sheets Next emits itself. The
        repo already knew this — the same discovery is recorded on the
        `/railway-styles.css` link that used to live in the body.

        The other remedy React's message offers is a hand-written head element
        around this link. Both were run against a dev server rather than
        reasoned about, and the honest result is that BOTH clear every warning
        above — so "it stops the errors" does not choose between them. What
        chooses is the rest:

          - root-language-provider-layout.test.tsx fails on a manual head tag
            here (measured: it is the assertion that fires). The reason it
            guards that is recorded with it — writing one made Railway stream
            malformed HTML with the opening document tags missing, a
            production-only failure no local dev server will reproduce.
          - a precedence hands the sheet to React as a managed resource, so it
            is deduplicated and ordered against Next's own route stylesheets
            instead of merely sitting in the right place.

        ⚠ And it is `precedence`, spelled exactly. The prop is not in
        @types/react@18, so it is declared in
        types/react-stylesheet-precedence.d.ts — deliberately as a named prop
        rather than spread in, because a spread would compile a misspelling
        silently and put the bailout straight back.

        Covers the one design system that was silently falling back to system
        fonts because its CSS assumed a <link> existed elsewhere and none ever
        did:
          - .af-core (af-core.css): dashboard, Player Finder, my team, matchup,
            trades, waivers, Draft HQ, War Room, and the homepage (LandingV4
            imports af-core.css directly) — wants Archivo + JetBrains Mono.

        ⚠ BEBAS NEUE AND OUTFIT WERE DROPPED FROM THIS URL, recorded here rather
        than trimmed silently. They existed only for `.af-adaptive`
        (adaptive-dashboard.css), whose consumers were the three unrendered
        dashboards deleted in 15c912781. That stylesheet had ZERO import
        statements afterwards, so nothing could define `.af-adaptive` at all,
        and it is deleted in this commit.

        🛑 BEBAS NEUE LOOKED LIVE AND WAS NOT, which is the only part of this
        worth a second reading. `public/railway-styles.css` still uses it — but
        that file is served-but-unreferenced: its
        `<link href="/railway-styles.css">` was deliberately removed from this
        layout, and root-language-provider-layout.test.tsx asserts it stays
        removed. A grep for the family name finds it and implies the opposite.

        af-core.css reads each family by name with a full fallback chain
        (e.g. `font-family: 'Archivo', ui-sans-serif, system-ui, sans-serif`),
        so this <link> is the only thing needed — no CSS variable to define.
        Global, but inert for every page that doesn't render matching text: the
        browser fetches this one small stylesheet and downloads a font file
        only when it's actually needed.
      */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;500;700;800&display=swap"
        precedence="default"
      />
      <body
        className="antialiased min-h-screen mode-readable"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >

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
              `}
            </Script>
          </>
        )}

        {/*
          Google Tag Manager.

          🛑 EVERY BASE PIXEL LIVES IN THE CONTAINER, NOT HERE — AND THE COMMENT
          THAT USED TO SIT IN THIS SPOT SAID THE OPPOSITE. It read "this container
          must not carry a Meta Pixel base tag or a Google tag, both are already
          installed directly above". That was true of the SOURCE and false of
          PRODUCTION, and acting on it cost a real defect: measured 2026-09-04,
          `fbq` was `undefined` on the live site and all five Meta conversion tags
          threw `ReferenceError: fbq is not defined` on every conversion.

          The reason is the guards. `metaPixelId` and `gaMeasurementId` come from
          NEXT_PUBLIC_META_PIXEL_ID and NEXT_PUBLIC_GA_MEASUREMENT_ID, and BOTH ARE
          EMPTY IN RAILWAY — so neither block above renders, and neither fbq nor
          gtag has ever existed on allfantasy.ai. Reading the JSX and concluding
          "already installed" is the trap; read the served page instead.

          So GTM-MF55JF4R carries the Meta Pixel base (dataset 1595613188959043),
          TikTok and Reddit bases, and a Google tag belongs there too once the new
          Ads account has a conversion id. The double-count warning is still real
          but INVERTED: it only bites if someone POPULATES those env vars, which
          would give a second fbq/gtag init alongside the container's. Set the
          pixel in one place or the other, never both.

          ⚠ The `gtag('config','AW-17768764414')` that used to sit in the block
          above is gone: it belonged to Google Ads account 677-276-4341, which is
          paused and is no longer where AllFantasy advertises (874-315-8568 is).
          It had never fired — it sat inside the empty `gaMeasurementId` guard —
          so removing it changes no behaviour and stops the file asserting a wrong
          account id.

          The init script is `beforeInteractive` on purpose: `dataLayer` has to be
          an array before the container script runs, and before any component
          effect can push onto it. lib/analytics/dataLayer.ts creates the array
          itself if it has to, so a push that lands first is not lost — but the
          ordering here is what makes that the fallback rather than the norm.

          No <noscript> iframe: it only serves JS-disabled clients, who cannot use
          the app at all, and it is a documented source of hydration warnings.
        */}
        {gtmId && (
          <>
            <Script id="gtm-init" strategy="beforeInteractive">
              {`window.dataLayer = window.dataLayer || [];`}
            </Script>
            <Script id="gtm-loader" strategy="afterInteractive">
              {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');`}
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
            {/*
              MetaPixelPageViewTracker calls useSearchParams(). A client component
              that reads the search params de-opts everything above it up to the
              nearest Suspense boundary, and this is the ROOT layout — with no
              boundary, that is the whole document, so the server stopped emitting
              <!DOCTYPE html>, <html>, <head> and <body> on every App Router route.
              Pages Router (/500) was unaffected, which is why the two disagreed.

              The boundary keeps the de-opt inside these two widgets instead of
              taking the document shell with it.
            */}
            <Suspense fallback={null}>
              {isVisualQaMode ? null : <MetaPixelPageViewTracker pixelId={metaPixelId} />}
              <SafeGlobalChrome fbAppId={fbAppId} />
            </Suspense>
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


