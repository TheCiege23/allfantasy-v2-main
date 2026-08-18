#!/usr/bin/env node
/**
 * Dead-code report - reachability analysis over the real import graph.
 *
 * Seeds from actual entry points (Next.js special files, middleware, tooling
 * configs, package.json-referenced scripts, CI/vercel config) and walks every
 * static + dynamic import. Anything nothing reaches is a deletion candidate.
 *
 * This is a CANDIDATE GENERATOR, not a verdict. Known blind spots are printed
 * as caveats at the bottom of the output. Verify before deleting.
 *
 *   node scripts/dead-code-report.mjs                # summary
 *   node scripts/dead-code-report.mjs --list         # every candidate path
 *   node scripts/dead-code-report.mjs --dirs         # fully-dead directories
 *   node scripts/dead-code-report.mjs --json out.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const argv = process.argv.slice(2);
const want = (flag) => argv.includes(flag);

// ---------------------------------------------------------------- universe
const tracked = execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1 << 30 })
  .toString()
  .split('\0')
  .filter(Boolean);

const IGNORED =
  /^(\.next|node_modules|playwright-report|test-results|public|docs|artifacts|design-refs|_design-refs|\.agents|\.cursor|\.tmp)/;

const universe = new Set(
  tracked
    .map((f) => f.split(String.fromCharCode(92)).join('/'))
    .filter((f) => EXTS.includes(path.extname(f)) && !IGNORED.test(f))
);

// ---------------------------------------------------------------- resolver
const statCache = new Map();
const isFile = (p) => {
  if (!statCache.has(p)) {
    let ok = false;
    try {
      ok = fs.statSync(path.join(ROOT, p)).isFile();
    } catch {
      ok = false;
    }
    statCache.set(p, ok);
  }
  return statCache.get(p);
};

function resolveSpec(spec, from) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.'))
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null; // bare package - not ours

  if (EXTS.includes(path.extname(base)) && isFile(base)) return base;
  for (const e of EXTS) if (isFile(base + e)) return base + e;
  for (const e of EXTS) if (isFile(base + '/index' + e)) return base + '/index' + e;
  return null;
}

// ---------------------------------------------------------------- edges
const STATIC_RE = /(?:^|[^\w$.])(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const depCache = new Map();
function depsOf(file) {
  if (depCache.has(file)) return depCache.get(file);
  let src = '';
  try {
    src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    /* unreadable - treat as leaf */
  }
  const out = new Set();
  for (const re of [STATIC_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const r = resolveSpec(m[1], file);
      if (r && universe.has(r)) out.add(r);
    }
  }
  const arr = [...out];
  depCache.set(file, arr);
  return arr;
}

// ---------------------------------------------------------------- entry points
const NEXT_SPECIAL =
  /\/(page|layout|route|loading|error|not-found|template|default|global-error|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.(ts|tsx|js|jsx)$/;

const TOOLING =
  /^(next\.config\.js|tailwind\.config\.js|postcss\.config\.js|playwright\.config\.ts|vitest\.setup\.ts|vitest[\w.-]*\.config\.ts|sentry\.[a-z]+\.config\.ts|middleware\.ts|instrumentation\.ts)$/;

/**
 * Entry points the import graph cannot discover on its own: things a human or a
 * process manager launches directly. Add to this list rather than letting the
 * report call them dead - each one here was verified as a real runtime entry.
 */
const MANUAL_ENTRIES = new Set([
  // Long-running worker process, started out-of-band. Documented in
  // docs/PROMPT328_BACKGROUND_JOB_SYSTEM.md and referenced by instrumentation.ts.
  'scripts/start-worker.ts',
  // Browser extension: Chrome loads these from extension/manifest.json, so no
  // module in this repo ever imports them.
  'extension/background.js',
  'extension/popup.js',
]);

const isProdEntry = (f) =>
  (f.startsWith('app/') && NEXT_SPECIAL.test('/' + f)) ||
  f.startsWith('pages/') ||
  TOOLING.test(f) ||
  MANUAL_ENTRIES.has(f) ||
  f === 'prisma/seed.ts';

const isTestFile = (f) =>
  /^(__tests__|e2e|tests)\//.test(f) || /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f);

// scripts invoked from package.json / vercel.json / CI are real entry points
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let cfgBlob = Object.values(pkg.scripts || {}).join(' ');
for (const p of ['vercel.json', 'railway.json', 'nixpacks.toml']) {
  try {
    cfgBlob += fs.readFileSync(path.join(ROOT, p), 'utf8');
  } catch {
    /* optional */
  }
}
try {
  const wf = path.join(ROOT, '.github/workflows');
  for (const f of fs.readdirSync(wf)) cfgBlob += fs.readFileSync(path.join(wf, f), 'utf8');
} catch {
  /* optional */
}
const invokedScript = (f) => f.startsWith('scripts/') && cfgBlob.includes(f);

/**
 * Nested package.json files mark distributable packages (the sdk-runtime/*
 * widget packages, for one). Their consumers live outside this repo entirely,
 * so the import graph can never reach them - seed each package's declared
 * entry fields as roots instead, or the whole package reads as dead.
 */
function packageEntryPoints() {
  const roots = new Set();
  const pkgFiles = tracked
    .map((f) => f.split(String.fromCharCode(92)).join('/'))
    .filter((f) => f.endsWith('/package.json') && !IGNORED.test(f));

  for (const pf of pkgFiles) {
    const dir = path.posix.dirname(pf);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(ROOT, pf), 'utf8'));
    } catch {
      continue;
    }
    const specs = [];
    const collect = (v) => {
      if (typeof v === 'string') specs.push(v);
      else if (v && typeof v === 'object') for (const k of Object.values(v)) collect(k);
    };
    collect(manifest.main);
    collect(manifest.module);
    collect(manifest.browser);
    collect(manifest.exports);
    collect(manifest.bin);

    for (const s of specs) {
      // Declared entries often point at build output; map back to source too.
      const cleaned = s.replace(/^\.\//, '');
      const candidates = [
        cleaned,
        cleaned.replace(/^dist\//, 'src/'),
        cleaned.replace(/^dist\//, ''),
      ].flatMap((c) => [c, c.replace(/\.(js|mjs|cjs|d\.ts)$/, '.ts'), c.replace(/\.(js|mjs|cjs)$/, '.tsx')]);
      for (const c of candidates) {
        const r = resolveSpec('./' + c, dir + '/x');
        if (r && universe.has(r)) roots.add(r);
      }
    }
    // Fall back to the package's index if nothing resolved from the manifest.
    if (![...roots].some((r) => r.startsWith(dir + '/'))) {
      for (const c of ['index', 'src/index']) {
        const r = resolveSpec('./' + c, dir + '/x');
        if (r && universe.has(r)) roots.add(r);
      }
    }
  }
  return roots;
}

const pkgRoots = packageEntryPoints();
const prodRoots = [...universe].filter(
  (f) => isProdEntry(f) || invokedScript(f) || pkgRoots.has(f)
);
const testRoots = [...universe].filter(isTestFile);

// ---------------------------------------------------------------- reachability
function reach(roots) {
  const seen = new Set(roots);
  const stack = [...roots];
  while (stack.length) {
    for (const d of depsOf(stack.pop())) {
      if (!seen.has(d)) {
        seen.add(d);
        stack.push(d);
      }
    }
  }
  return seen;
}

const liveSet = reach(prodRoots);
const testSet = reach(testRoots);

const orphans = [];
const testOnly = [];
for (const f of universe) {
  if (liveSet.has(f) || isTestFile(f)) continue;
  (testSet.has(f) ? testOnly : orphans).push(f);
}
orphans.sort();
testOnly.sort();

// ---------------------------------------------------------------- fully-dead dirs
const deadSet = new Set(orphans);
const byDir = new Map();
for (const f of universe) {
  if (isTestFile(f)) continue;
  const d = path.posix.dirname(f);
  if (!byDir.has(d)) byDir.set(d, []);
  byDir.get(d).push(f);
}

const sizeOf = (f) => {
  try {
    return fs.statSync(path.join(ROOT, f)).size;
  } catch {
    return 0;
  }
};

const fullyDead = [];
for (const [d, files] of byDir) {
  if (d === '.' || files.length < 2) continue;
  if (files.every((f) => deadSet.has(f))) {
    fullyDead.push({ dir: d, n: files.length, bytes: files.reduce((s, f) => s + sizeOf(f), 0) });
  }
}
fullyDead.sort((a, b) => b.bytes - a.bytes);

// ---------------------------------------------------------------- output
const kb = (b) => (b / 1024).toFixed(0) + 'kb';
const mb = (b) => (b / 1048576).toFixed(1) + 'MB';
const totalBytes = (l) => l.reduce((s, f) => s + sizeOf(f), 0);

if (want('--dirs')) {
  for (const d of fullyDead) {
    console.log(`${String(d.n).padStart(4)}  ${kb(d.bytes).padStart(8)}  ${d.dir}`);
  }
} else if (want('--list')) {
  for (const f of orphans) console.log(f);
} else {
  const areaOf = (f) => {
    const p = f.split('/');
    return ['app', 'lib', 'components'].includes(p[0]) && p.length > 1 ? p[0] + '/' + p[1] : p[0];
  };
  const roll = (list) => {
    const m = new Map();
    for (const f of list) {
      const a = areaOf(f);
      const e = m.get(a) || { n: 0, b: 0 };
      e.n++;
      e.b += sizeOf(f);
      m.set(a, e);
    }
    return [...m].sort((x, y) => y[1].b - x[1].b);
  };

  const deadDirFiles = fullyDead.reduce((s, d) => s + d.n, 0);
  const deadDirBytes = fullyDead.reduce((s, d) => s + d.bytes, 0);

  console.log(`tracked source files       ${universe.size}`);
  console.log(`entry points (prod)        ${prodRoots.length}`);
  console.log(`reachable from entries     ${liveSet.size}`);
  console.log('');
  console.log(`UNREACHABLE                ${orphans.length} files, ${mb(totalBytes(orphans))}`);
  console.log(
    `  in fully-dead dirs       ${deadDirFiles} files / ${fullyDead.length} dirs, ${mb(deadDirBytes)}   <- safest to delete`
  );
  console.log(
    `REACHED ONLY BY TESTS      ${testOnly.length} files, ${mb(totalBytes(testOnly))}   <- dead code + the tests pinning it`
  );
  console.log('');
  console.log('--- unreachable, by area ---');
  for (const [a, e] of roll(orphans).slice(0, 25)) {
    console.log(`  ${String(e.n).padStart(4)}  ${kb(e.b).padStart(8)}  ${a}`);
  }
  console.log('');
  console.log('--- largest fully-dead directories ---');
  for (const d of fullyDead.slice(0, 20)) {
    console.log(`  ${String(d.n).padStart(4)}  ${kb(d.bytes).padStart(8)}  ${d.dir}`);
  }
  console.log('');
  console.log('Caveats - this graph cannot see:');
  console.log('  * files loaded by string path at runtime (fs.readFile, generated imports)');
  console.log('  * API routes called only by external callers (Stripe/Resend webhooks, cron,');
  console.log('    the browser extension). route.ts is always treated as LIVE here anyway.');
  console.log('  * components referenced only from .mdx/.html or other non-source files');
  console.log('  Spot-check with --list before deleting. Delete in tiers, build between them.');
}

const jsonIdx = argv.indexOf('--json');
if (jsonIdx !== -1) {
  const out = argv[jsonIdx + 1] || 'dead-code-report.json';
  fs.writeFileSync(out, JSON.stringify({ orphans, testOnly, fullyDead, entryCount: prodRoots.length }, null, 2));
  console.log(`\nwrote ${out}`);
}
