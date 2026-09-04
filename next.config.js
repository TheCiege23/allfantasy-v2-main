/** @type {import('next').NextConfig} */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withSentryConfig } = require('@sentry/nextjs')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false, // write HTML files without auto-opening a browser
})

const isProd = process.env.NODE_ENV === 'production';
const isRailwayRuntime = !!(
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_SERVICE_ID ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RAILWAY_GIT_COMMIT_SHA
);

// 🛑 DIAGNOSTIC ONLY, RAILWAY ONLY — the other half of `experimental.serverSourceMaps`
// below. That flag makes Next EMIT `.map` files for the server bundle; it does NOT make
// Node's uncaught-exception printer consult them. Measured on a304abd35: maps enabled,
// stack trace still `chunks/2034.js:1:50150`. Node only rewrites a thrown error's stack
// through source maps when started with `--enable-source-maps`.
//
// It has to travel via NODE_OPTIONS, not as a CLI flag on the parent `node … next build`
// process: the #673 crash happens inside the forked static-generation WORKER, and Next
// forks that worker with `NODE_OPTIONS: getNodeOptionsWithoutInspect()` — read LIVE from
// process.env at fork time, with only --inspect* and --max-old-space-size stripped
// (next/dist/build/index.js createStaticWorker, next/dist/server/lib/utils.js). A parent
// CLI flag is not inherited by that fork; a mutation here runs before any worker exists.
//
// Gated to Railway so peers' local `npm run build` (Windows, where `VAR=x cmd` is not a
// thing) is untouched. Remove together with serverSourceMaps once the real cause is found.
if (isRailwayRuntime) {
  const existing = process.env.NODE_OPTIONS || '';
  if (!existing.includes('--enable-source-maps')) {
    process.env.NODE_OPTIONS = `${existing} --enable-source-maps`.trim();
  }
}

const nextConfig = {
  reactStrictMode: true,
    optimizeFonts: false,
  distDir: process.env.AF_NEXT_DIST_DIR || (isProd ? '.next' : '.next-dev-local'),

  // Skip in-build type-check and lint passes — they OOM in Vercel's build container
  // on this codebase size. TypeScript errors are caught in local pre-deploy checks.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack: (config, { isServer, dev }) => {
    // Absolute module paths must resolve as absolute paths.
    //
    // webpack 5 defaults `resolve.roots` to [context] and enhanced-resolve's
    // RootsPlugin runs BEFORE the plain absolute-path join, so any request that
    // starts with "/" is first tried as <context>/<request-minus-leading-slash>.
    // Next's app loader emits every layout/page/error/not-found file as an
    // absolute path. On Railway the repo is mounted at /app, so the root layout
    // is requested as "/app/app/layout.tsx", which the RootsPlugin rewrites to
    // "/app/app/app/layout.tsx" -- and that file exists: it is the nested
    // app/app/layout.tsx route layout. The build then compiled THAT as the root
    // layout: no <html>/<body> in the document, app/globals.css never entered
    // the module graph, and every route rendered unstyled and failed to hydrate.
    // Vercel (/vercel/path0) and Windows (C:/...) never hit it because their
    // roots do not collide with a directory inside the repo. Measured 2026-09-02
    // with the resolver in isolation and against the served Railway HTML.
    //
    // An empty roots list is what Next already uses for its own node resolver;
    // nothing in this repo imports server-relative "/..." specifiers, and Next's
    // css-loader does not resolve root-relative url()s, so this is inert
    // everywhere except where it was silently wrong.
    config.resolve = { ...config.resolve, roots: [] };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        path: false,
      };
    }

    if (process.platform === 'win32') {
      // Windows + webpack filesystem cache can intermittently corrupt .next vendor chunks.
      // On exFAT volumes, Node can also report EISDIR for readlink() on normal files
      // during webpack dependency snapshotting, which blocks production builds.
      config.cache = false;
    }

    // On Railway (Linux production), disable the webpack filesystem cache entirely.
    // Railway's Nixpacks builder mounts a persistent Docker cache volume at
    // .next/cache between builds (id keyed to service ID, not commit SHA).
    // When layout.tsx / globals.css don't change between commits, webpack
    // reuses stale cache entries that omit CSS from app-build-manifest.json,
    // causing the deployed site to have no <link rel="stylesheet"> tags.
    // We also detect Railway via RAILWAY_ENVIRONMENT (more reliably injected
    // at build time than RAILWAY_PROJECT_ID) and fall back to process.platform
    // so Linux CI/CD environments are always protected even without Railway vars.
    const isRailwayBuild = !!(
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_DEPLOYMENT_ID ||
      process.env.RAILWAY_GIT_COMMIT_SHA
    );
    if (!dev && (isRailwayBuild || process.platform === 'linux')) {
      config.cache = false;
    }

    // Temporary, opt-in via AF_CSS_DEBUG=1. The root layout's stylesheet does not
    // reach the page and no emitted asset anywhere in the build contains Tailwind's
    // output, so this asks webpack directly whether it has the module at all.
    if (process.env.AF_CSS_DEBUG === '1') {
      config.plugins = config.plugins || [];
      config.plugins.push({
        apply(compiler) {
          compiler.hooks.done.tap('AfCssDebug', (stats) => {
            try {
              const compilation = stats.compilation;
              const matches = [];
              for (const mod of compilation.modules) {
                const resource =
                  mod.resource || (typeof mod.identifier === 'function' ? mod.identifier() : '');
                const text = String(resource || '');
                if (text.includes('globals.css')) matches.push(text.slice(-140));
              }
              // Compilation-level failures nothing has inspected yet. A css-loader or
              // postcss error on a 776KB file would explain a module that never
              // appears in the graph.
              const errs = (compilation.errors || []).map((e) => String(e && (e.message || e)).slice(0, 300));
              const warns = (compilation.warnings || []).map((w) => String(w && (w.message || w)).slice(0, 200));
              console.log(
                '[af-css-debug] name=%s isServer=%s errors=%d warnings=%d',
                compilation.name || '(unnamed)',
                isServer,
                errs.length,
                warns.length,
              );
              for (const e of errs.slice(0, 4)) console.log('[af-css-debug]   ERROR: %s', e);
              for (const w of warns.slice(0, 4)) console.log('[af-css-debug]   WARN: %s', w);

              // Broad sweep: anything mentioning globals, and how the root layout is
              // actually identified (next-app-loader / private-next-app-dir forms).
              const anyGlobals = [];
              const rootLayoutish = [];
              for (const mod of compilation.modules) {
                const raw =
                  mod.resource || (typeof mod.identifier === 'function' ? mod.identifier() : '');
                const text = String(raw || '');
                if (text.includes('globals')) anyGlobals.push(text.slice(-160));
                if (text.includes('private-next-app-dir') || text.includes('next-app-loader')) {
                  rootLayoutish.push(text.slice(-160));
                }
              }
              console.log(
                '[af-css-debug] isServer=%s anyModuleMentioningGlobals=%d %s',
                isServer,
                anyGlobals.length,
                JSON.stringify(anyGlobals.slice(0, 6)),
              );
              console.log(
                '[af-css-debug] isServer=%s appLoaderModules=%d %s',
                isServer,
                rootLayoutish.length,
                JSON.stringify(rootLayoutish.slice(0, 3)),
              );

              // Every module whose file is named layout.tsx, so the root layout can be
              // told apart from the nested /app one by full path.
              const layoutFiles = [];
              let rootEntry = null;
              for (const mod of compilation.modules) {
                const res = String(mod.resource || '');
                if (res.endsWith('layout.tsx')) layoutFiles.push(res);
                const id = typeof mod.identifier === 'function' ? String(mod.identifier()) : '';
                if (!rootEntry && id.includes('name=app%2Flayout&') && id.includes('page=%2Flayout')) {
                  rootEntry = mod;
                }
              }
              console.log(
                '[af-css-debug] isServer=%s layoutTsxModules=%d %s',
                isServer,
                layoutFiles.length,
                JSON.stringify(layoutFiles.slice(0, 8)),
              );

              if (rootEntry) {
                const id = String(rootEntry.identifier());
                console.log('[af-css-debug] ROOT ENTRY id(first 300)=%s', id.slice(0, 300));
                let src = '';
                try {
                  const os = rootEntry.originalSource && rootEntry.originalSource();
                  src = os ? String(os.source()).slice(0, 700) : '(no originalSource)';
                } catch (e) {
                  src = '(source threw: ' + (e && e.message) + ')';
                }
                console.log('[af-css-debug] ROOT ENTRY source(first 700)=%s', JSON.stringify(src));
              } else {
                console.log('[af-css-debug] ROOT ENTRY not found in this compilation');
              }

              const cssModules = [];
              const layoutModules = [];
              for (const mod of compilation.modules) {
                const resource =
                  mod.resource || (typeof mod.identifier === 'function' ? mod.identifier() : '');
                const text = String(resource || '');
                if (/\.css(\?|$)/.test(text)) cssModules.push(text.split('/').slice(-2).join('/'));
                if (text.includes('app/layout.')) layoutModules.push(text.slice(-100));
              }
              console.log(
                '[af-css-debug] isServer=%s cssModulesInGraph=%d %s',
                isServer,
                cssModules.length,
                JSON.stringify(cssModules.slice(0, 40)),
              );
              console.log(
                '[af-css-debug] isServer=%s ROOT LAYOUT modules=%d %s',
                isServer,
                layoutModules.length,
                JSON.stringify(layoutModules.slice(0, 6)),
              );
              const cssAssets = Object.keys(compilation.assets).filter((a) => a.endsWith('.css'));
              console.log(
                '[af-css-debug] isServer=%s modulesMatchingGlobalsCss=%d %s',
                isServer,
                matches.length,
                JSON.stringify(matches.slice(0, 6)),
              );
              console.log(
                '[af-css-debug] isServer=%s cssAssets=%d %s',
                isServer,
                cssAssets.length,
                JSON.stringify(cssAssets.slice(0, 12)),
              );
            } catch (err) {
              console.log('[af-css-debug] failed (non-fatal):', err && err.message);
            }
          });
        },
      });
    }

    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /bullmq[\\/]dist[\\/]esm[\\/]classes[\\/]child-processor\.js$/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },

  experimental: {
    // 🛑 DIAGNOSTIC ONLY — NOT A FIX. Do not remove this comment when it is removed.
    // Two reasoned attempts at the #673 useContext-null regression (08ee395c1,
    // ab6993b40) both failed on Railway with the byte-identical crash: same digest
    // (3463372292), same shared chunk (server/chunks/2034.js), across ~250 routes,
    // every time. Both were guesses tested against production Railway builds with
    // no way to confirm the mechanism, because production builds strip source maps
    // — the stack trace only ever names minified internal Next.js runtime frames
    // and an opaque chunk file, never the actual component/module at fault.
    //
    // This turns those maps back on for the SERVER bundle only (client bundle/UX
    // is unaffected either way) so the next occurrence of this crash — whether
    // from a real fix attempt or a plain retry — reports the real source file and
    // line instead of "chunks/2034.js:1:50150". Not reproducible locally (tried:
    // clean on Windows, and this repo's own history says an earlier structurally
    // similar bug "only shows up on the Linux builder" — ef1c84417), and Docker is
    // not available on this machine to test a Linux build directly. This is the
    // best remaining path to real evidence rather than another guess.
    //
    // Revert once the real cause is identified and fixed — source maps are extra
    // build output with no reason to ship indefinitely.
    serverSourceMaps: true,
    // Next 14.2 compiles the client and server passes in parallel build workers.
    // On Railway (Linux) that build loses the root layout: app-build-manifest.json
    // lists zero CSS for /layout, app/globals.css never enters the module graph,
    // and the served document has no <!DOCTYPE html>, <html>, <head> or <body> —
    // the layout is absent from the RSC tree entirely, so every page renders
    // unstyled and then fails to hydrate.
    //
    // The same commit built locally is correct: /layout carries its two
    // stylesheets, the 775KB Tailwind chunk is emitted, and the document has its
    // shell. The difference is the build, not the code. This repo already carries
    // scripts/patch-manifest-race.cjs for a concurrent manifest write race in the
    // pages manifest; this is the same failure one manifest over.
    //
    // Serialising the compilations costs build time and nothing else.
    webpackBuildWorker: false,
    instrumentationHook: process.env.NODE_ENV === 'production' || process.env.AF_ENABLE_DEV_INSTRUMENTATION === '1',
    outputFileTracingIncludes: {
      "/api/**": ["./data/**"],
    },
    // Rewrites barrel imports (`import { Icon } from 'lucide-react'`) into direct
    // path imports so a route ships only the icons/helpers it actually uses
    // instead of the whole package. Only list packages this repo imports from —
    // verified via `grep -rl "from '<pkg>'" app components lib` before adding.
    //
    // ⚠ `recharts` and `framer-motion` are deliberately not (re-)listed here, but
    // this is NOT the fix for the #673 useContext regression — that theory was
    // tested and disproven. `recharts` is unconditionally on Next 14.2.35's own
    // built-in default optimizePackageImports list (grep node_modules/next/dist/
    // server/config.js), so it was never possible to opt it out via this array in
    // the first place. `framer-motion` is genuinely NOT on that default list, so
    // removing it here should have mattered — except a rebuild of the exact same
    // source with it removed crashed with the byte-identical error, in the exact
    // same shared chunk number, as the build that still had it listed. That rules
    // out optimizePackageImports as the mechanism entirely. See `cpus: 1` below
    // for what the evidence actually points to.
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
    ],
    // 🛑 Forces static generation (the `Generating static pages` phase, which
    // runs AFTER webpack compilation succeeds) onto a single worker process
    // instead of Next's default of 4 parallel forked workers. Not a guess: the
    // exact same commit (6e7818d95) produced one SUCCESS Railway deployment and
    // one FAILED one three minutes apart — the useContext-null crash is
    // nondeterministic, not a property of the source. Compilation ("✓ Compiled
    // successfully") is unaffected in every failing build; only the parallel
    // static-generation worker pool (next/dist/build/index.js's
    // getNumberOfWorkers, defaulting to 4) runs after that point, and this repo
    // already has one confirmed precedent for exactly this shape of bug —
    // `webpackBuildWorker: false` above, added for a *different* parallel-worker
    // race (the client/server compile split) that dropped the root layout's
    // shell entirely on Railway's Linux builder. That fix's own reasoning
    // applies here unchanged: "serialising costs build time and nothing else."
    cpus: 1,
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com" },
      { protocol: "https", hostname: "cdn.sleeper.app" },
      { protocol: "https", hostname: "a.espncdn.com" },
      { protocol: "https", hostname: "static.www.nfl.com" },
      { protocol: "https", hostname: "cdn.nba.com" },
      { protocol: "https", hostname: "img.mlbstatic.com" },
      { protocol: "https", hostname: "ak-static.cms.nba.com" },
      // World Cup chat + media
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "media.giphy.com" },
      { protocol: "https", hostname: "i.giphy.com" },
      { protocol: "https", hostname: "media.tenor.com" },
      { protocol: "https", hostname: "c.tenor.com" },
      { protocol: "https", hostname: "media.api-sports.io" },
      { protocol: "https", hostname: "flagcdn.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
    ],
  },

  // Default dev port is 3000 (next dev). 5000 kept for optional compatibility.
  allowedDevOrigins: [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
    "http://127.0.0.1:3010",
    "http://localhost:3010",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
  ],

  async rewrites() {
    return [
      // PostHog ingestion proxy — avoids ad-blocker interference
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://us-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ]
  },

  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,

  async redirects() {
    return [
      // Alias pages removed from build to stay under Vercel's 2048-route cap.
      { source: '/march-madness', destination: '/brackets', permanent: false },
      { source: '/march-madness/join', destination: '/brackets/join', permanent: false },
      { source: '/wallet/deposit', destination: '/donate', permanent: false },
      // /pools/* → /brackets/* alias so UI copy can use "pool" everywhere while the canonical
      // route slug stays /brackets (renaming the route tree would touch ~225 files and break
      // live invite + reminder URLs already in users' inboxes).
      { source: '/pools', destination: '/brackets', permanent: false },
      { source: '/pools/:path*', destination: '/brackets/:path*', permanent: false },
      // /dashboard/brackets/world-cup/* → /brackets/world-cup/* (5 pages collapsed to 2 redirects)
      { source: '/dashboard/brackets/world-cup', destination: '/brackets/world-cup', permanent: true },
      { source: '/dashboard/brackets/world-cup/:path*', destination: '/brackets/world-cup/:path*', permanent: true },
      // /app/tournament/* → /tournament/* (5 pages collapsed to 2 redirects)
      { source: '/app/tournament', destination: '/tournament', permanent: true },
      { source: '/app/tournament/:path*', destination: '/tournament/:path*', permanent: true },
    ]
  },

  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      // Do not add `/api/:path*` here: Next/Vercel expands it to one header rule per API route
      // (~1600+) and exceeds the 2048 rewrite/redirect/header route cap. API routes get the same
      // headers from `middleware.ts` (`applyApiSecurityHeaders`).
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isProd
              ? "public, max-age=31536000, immutable"
              : "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

// ── Sentry ────────────────────────────────────────────────────────────────────
// Only wrap when a DSN is configured so local dev builds work without Sentry
// credentials. The Sentry webpack plugin uploads source maps and injects the
// SDK config files (sentry.*.config.ts) into the appropriate bundles.
//
// Required env vars for source-map upload (Vercel → Settings → Environment):
//   SENTRY_AUTH_TOKEN   — project auth token from sentry.io
//   SENTRY_ORG          — Sentry organization slug
//   SENTRY_PROJECT      — Sentry project slug
//   NEXT_PUBLIC_SENTRY_DSN or SENTRY_DSN  — DSN from project settings
const hasSentryDsn =
  !!(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN)

const configWithSentry = hasSentryDsn
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG ?? '',
      project: process.env.SENTRY_PROJECT ?? '',
      // Suppress verbose Sentry CLI output in non-CI environments.
      silent: !process.env.CI,
      // Upload client-side source maps for better stack traces.
      widenClientFileUpload: true,
      // Strip source maps from the deployed bundle (they're in Sentry).
      hideSourceMaps: true,
      // Suppress the Sentry logger in the bundle (saves ~7 kB).
      disableLogger: true,
      // We manage Vercel Cron Monitors separately.
      automaticVercelMonitors: false,
    })
  : nextConfig;

// ── Bundle analysis ───────────────────────────────────────────────────────────
// Gated on ANALYZE=true so normal builds are unaffected.
// Usage:  ANALYZE=true npm run build
// Output: .next/analyze/client.html  and  .next/analyze/nodejs.html
module.exports = withBundleAnalyzer(configWithSentry);
