/**
 * Railway Tailwind CSS prebuild script.
 *
 * Problem: On Railway (Node Linux / Docker), the tailwindcss PostCSS plugin
 * sometimes silently produces 0 bytes of CSS when run inside webpack workers —
 * either due to a stale postcss-loader disk cache or ESM-package loading issues
 * in the worker context.  The result is that mini-css-extract-plugin has nothing
 * to extract, app-build-manifest.json lists no CSS for /layout, and every page
 * is completely unstyled.
 *
 * Fix: run the Tailwind CLI as a *separate process* BEFORE `next build`.  The CLI
 * reads the pristine source (which contains @tailwind base/components/utilities),
 * scans all content files, and writes the compiled CSS to app/globals.css.  When
 * webpack subsequently processes globals.css it sees plain CSS (no @tailwind
 * directives), so postcss-loader's tailwindcss plugin is a no-op, autoprefixer
 * adds vendor prefixes, and mini-css-extract creates the correct CSS chunk.
 *
 * ---------------------------------------------------------------------------
 * HISTORY — why this script is shaped the way it is (2026-08-25)
 *
 * A previous version opened with a shortcut: if public/railway-styles.css
 * existed and cleared 100KB, it copied that file over globals.css and exited
 * WITHOUT COMPILING.  Because that cache file is committed and was 671KB, the
 * branch fired on every single build.  Railway shipped CSS frozen at
 * 2026-05-31 for nearly three months; every Tailwind class added after that
 * date had no rule behind it, and the site rendered essentially unstyled.
 *
 * The rule that came out of that: A CACHED ARTIFACT IS NOT EVIDENCE THAT
 * COMPILATION SUCCEEDED.  It may only be used when compilation has actually
 * been attempted and actually failed — never in place of attempting it.
 * Shipping silently-stale CSS is worse than failing the build, because a
 * failed build tells you something is wrong and stale CSS does not.
 * ---------------------------------------------------------------------------
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isRailway = !!(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_SERVICE_ID ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.AF_NEXT_DIST_DIR?.startsWith('.next-railway')
);

const isLinuxProdBuild =
  process.platform === 'linux' &&
  !process.env.VERCEL &&
  !process.env.VERCEL_URL;

/**
 * Floor for "this looks like a real Tailwind build". The full sheet is ~775KB;
 * anything under this is the 0-byte/near-empty failure this script exists to
 * catch, not a legitimately small stylesheet.
 */
const MIN_RAILWAY_CSS_BYTES = 100_000;

/**
 * Escape hatch. Set to '1' to let a build continue on the committed fallback
 * when compilation fails, instead of failing outright. Intended for an
 * emergency ship when Tailwind itself is broken — NOT for routine use, because
 * it reintroduces the silent-stale-CSS failure mode described above.
 */
const allowStaleFallback = process.env.AF_ALLOW_STALE_RAILWAY_CSS === '1';

if (!isRailway && !isLinuxProdBuild) {
  console.log('[railway-prebuild] Not a Railway/Linux prod build — skipping Tailwind CLI prebuild.');
  process.exit(0);
}

const cwd = process.cwd();
const globalsCss = path.join(cwd, 'app', 'globals.css');
const sourceCss = path.join(cwd, 'app', 'globals.tailwind-source.css');
const compiledTmp = path.join(cwd, 'app', 'globals-compiled.css');
const fallbackCss = path.join(cwd, 'public', 'railway-styles.css');
const twConfig = path.join(cwd, 'tailwind.config.js');
const twBin = path.join(cwd, 'node_modules', '.bin', 'tailwindcss');

console.log(
  '[railway-prebuild] Railway detected (env=%s). Compiling Tailwind CSS via CLI...',
  process.env.RAILWAY_ENVIRONMENT || 'unknown'
);

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function ageInDays(file) {
  try {
    return (Date.now() - fs.statSync(file).mtimeMs) / 86_400_000;
  } catch {
    return Infinity;
  }
}

/**
 * Fall back to the committed stylesheet, loudly. Only reachable after a real
 * compilation attempt has failed.
 */
function useFallbackOrFail(reason) {
  const bytes = sizeOf(fallbackCss);
  const days = ageInDays(fallbackCss);

  if (bytes < MIN_RAILWAY_CSS_BYTES) {
    console.error(
      '[railway-prebuild] FATAL: %s, and no usable fallback exists (public/railway-styles.css is %d bytes).',
      reason,
      bytes
    );
    process.exit(1);
  }

  if (!allowStaleFallback) {
    console.error('[railway-prebuild] FATAL: %s.', reason);
    console.error(
      '[railway-prebuild] A fallback exists (%d bytes, %s days old) but will NOT be used automatically.',
      bytes,
      days === Infinity ? 'unknown' : days.toFixed(1)
    );
    console.error(
      '[railway-prebuild] Shipping it would silently serve stale CSS. Fix the Tailwind build, or set'
    );
    console.error(
      '[railway-prebuild] AF_ALLOW_STALE_RAILWAY_CSS=1 to deliberately ship the stale sheet.'
    );
    process.exit(1);
  }

  console.warn(
    '[railway-prebuild] WARNING: %s. AF_ALLOW_STALE_RAILWAY_CSS=1 is set — shipping the committed fallback.',
    reason
  );
  console.warn(
    '[railway-prebuild] WARNING: that stylesheet is %s days old. Classes added since then WILL have no styling.',
    days === Infinity ? 'an unknown number of' : days.toFixed(1)
  );
  fs.copyFileSync(fallbackCss, globalsCss);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Establish the pristine source.
//
// globals.css is the compile TARGET, so after a successful run it no longer
// contains @tailwind directives. Compiling from it a second time would produce
// a stylesheet from already-expanded CSS. The source is therefore pinned to its
// own file the first time we see directives, and every compile reads from that.
// This also means a clobbered globals.css is recoverable.
// ---------------------------------------------------------------------------
if (!fs.existsSync(sourceCss)) {
  if (!fs.existsSync(globalsCss)) {
    console.error('[railway-prebuild] FATAL: neither app/globals.css nor the pinned source exists.');
    process.exit(1);
  }

  const current = fs.readFileSync(globalsCss, 'utf8');
  if (!current.includes('@tailwind')) {
    // globals.css holds compiled output and no pristine source was ever pinned,
    // so the directives are not recoverable from this tree.
    useFallbackOrFail(
      'app/globals.css contains no @tailwind directives and no pinned source exists, ' +
        'so there is nothing to compile from'
    );
  }

  fs.copyFileSync(globalsCss, sourceCss);
  console.log('[railway-prebuild] Pinned pristine source -> app/globals.tailwind-source.css');
}

if (!fs.existsSync(twBin)) {
  useFallbackOrFail(`tailwindcss binary not found at ${twBin}`);
}

// ---------------------------------------------------------------------------
// Compile. This always runs — the presence of a cached artifact never skips it.
// ---------------------------------------------------------------------------
let compiledBytes = 0;

try {
  const cmd = `"${twBin}" -i "${sourceCss}" -o "${compiledTmp}" --minify --config "${twConfig}"`;
  console.log('[railway-prebuild] Running:', cmd);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env } });
  compiledBytes = sizeOf(compiledTmp);
  console.log('[railway-prebuild] Tailwind CLI output: %d bytes', compiledBytes);
} catch (err) {
  try {
    fs.unlinkSync(compiledTmp);
  } catch {
    /* nothing to clean up */
  }
  useFallbackOrFail(`Tailwind CLI failed: ${err.message}`);
}

if (compiledBytes < MIN_RAILWAY_CSS_BYTES) {
  try {
    fs.unlinkSync(compiledTmp);
  } catch {
    /* nothing to clean up */
  }
  // This is the original silent-failure mode: the CLI exits 0 having emitted
  // almost nothing. Treated as a failure, not as a smaller-than-usual success.
  useFallbackOrFail(
    `compiled CSS is only ${compiledBytes} bytes, below the ${MIN_RAILWAY_CSS_BYTES}-byte floor`
  );
}

// ---------------------------------------------------------------------------
// Publish. globals.css becomes the compiled sheet so webpack sees plain CSS,
// and the fallback is refreshed ONLY now — after a compile we trust.
// ---------------------------------------------------------------------------
fs.copyFileSync(compiledTmp, globalsCss);
fs.copyFileSync(compiledTmp, fallbackCss);
fs.unlinkSync(compiledTmp);

console.log('[railway-prebuild] ✓ app/globals.css written from fresh compile (%d bytes)', compiledBytes);
console.log('[railway-prebuild] ✓ public/railway-styles.css refreshed (%d bytes)', compiledBytes);
