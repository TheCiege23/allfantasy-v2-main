/** @type {import('next').NextConfig} */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withSentryConfig } = require('@sentry/nextjs')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false, // write HTML files without auto-opening a browser
})

const isProd = process.env.NODE_ENV === 'production';
const disableDiagInstrumentation = process.env.AF_NEXT_DIAG_DISABLE_INSTRUMENTATION === '1';
const disableDiagSwcMinify = process.env.AF_NEXT_DIAG_DISABLE_SWC_MINIFY === '1';

const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.AF_NEXT_DIST_DIR || (isProd ? '.next' : '.next-dev-local'),
  ...(disableDiagSwcMinify ? { swcMinify: false } : {}),

  // Skip in-build type-check and lint passes — they OOM in Vercel's build container
  // on this codebase size. TypeScript errors are caught in local pre-deploy checks.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        path: false,
      };
    }

    if (dev && process.platform === 'win32') {
      // Windows + webpack filesystem cache can intermittently corrupt .next vendor chunks.
      config.cache = false;
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
    instrumentationHook:
      !disableDiagInstrumentation &&
      (process.env.NODE_ENV === 'production' || process.env.AF_ENABLE_DEV_INSTRUMENTATION === '1'),
    outputFileTracingIncludes: {
      "/api/**": ["./data/**"],
    },
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

  async redirects() {
    return [
      // Alias pages removed from build to stay under Vercel's 2048-route cap.
      { source: '/march-madness', destination: '/brackets', permanent: false },
      { source: '/march-madness/join', destination: '/brackets/join', permanent: false },
      { source: '/wallet/deposit', destination: '/donate', permanent: false },
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