import type { Metadata } from 'next';
import type { Session } from 'next-auth';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { AppProviders } from '@/components/providers/AppProviders';
import { SpotifyMiniPlayer } from '@/components/spotify/SpotifyMiniPlayer';
import { FloatingMusicWidget } from '@/components/MusicWidget';
import { DefaultJsonLd } from '@/components/seo/JsonLd';
import { SafeGlobalChrome } from '@/components/shell/SafeGlobalChrome';
import { ErrorBoundaryClient } from '@/components/error-handling/ErrorBoundaryClient';
import { PlayerComparisonUIProvider } from '@/components/player-comparison-ui';
import { buildSeoMeta } from '@/lib/seo';
import { resolveEffectiveDataMode } from '@/lib/theme';
import {
  buildLanguageInitScript,
  buildThemeInitScript,
} from '@/lib/preferences/HtmlPreferenceSync';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['400', '500', '600', '700']
});

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
    title: 'AllFantasy – AI Powered Fantasy Sports Tools',
    description:
      'AllFantasy combines fantasy sports leagues, bracket challenges, and AI-powered tools to help players draft smarter, analyze trades, and dominate their leagues.',
    canonical: 'https://allfantasy.ai/',
    keywords: [
      'fantasy sports',
      'fantasy football tools',
      'fantasy trade analyzer',
      'AI fantasy sports',
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
  const htmlLang = cookieLang === 'es' ? 'es' : 'en';
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

  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID || '';
  const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID || '1790659191546539';

  return (
    <html
      lang={htmlLang}
      data-lang={htmlLang}
      data-mode={htmlMode}
      className={`${inter.variable} scroll-smooth`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Theme + language init scripts are safe on every route: they only
          touch `localStorage` and `<html>` data attributes, and the document
          element has `suppressHydrationWarning` so the post-script values
          will not produce a hydration error. PWA service-worker registration
          and the route-sensitive analytics scripts (Meta Pixel, Facebook SDK)
          live inside <SafeGlobalChrome /> in the body so they can use
          `usePathname()` to bail on auth routes without depending on the
          upstream `x-af-pathname` request header.
        */}
        <Script id="af-init-mode" strategy="beforeInteractive">
          {buildThemeInitScript(htmlMode)}
        </Script>
        <Script id="af-init-lang" strategy="beforeInteractive">
          {buildLanguageInitScript(htmlLang)}
        </Script>

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

      </head>

      <body
        className={`${inter.variable} antialiased min-h-screen mode-readable`}
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >
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
            <SafeGlobalChrome metaPixelId={metaPixelId} fbAppId={fbAppId} />
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


