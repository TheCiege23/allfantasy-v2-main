#!/usr/bin/env node
/**
 * Phase 0.3 — modules under lib/ with zero runtime consumers outside themselves.
 *
 * ONE pass over the tree, building a full specifier index, then set membership.
 * The per-directory-grep version of this took >10 min and was killed.
 *
 * Handles ALL FOUR import forms CLAUDE.md names, because a `from '@/lib/x'`
 * grep alone gave the wrong answer four separate times in one session:
 *   static `from '...'`, relative `./x` `../x`, `await import(...)`, `require(...)`
 *
 * A module is UNWIRED when every file that references it is inside the module
 * itself, or is a test. Reported as candidates, never as a delete list.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'

const ROOT = 'C:/allfantasy-v2-main'
const SEARCH_ROOTS = ['app', 'lib', 'components', 'scripts', 'server', 'hooks', 'pages', 'graphql']
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'dist', 'build', '__mocks__'])
const EXT = /\.(ts|tsx|mjs|js|jsx)$/

const files = []
function walk(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name) || e.name.startsWith('.next')) continue
      walk(join(dir, e.name))
    } else if (EXT.test(e.name)) {
      files.push(join(dir, e.name))
    }
  }
}
for (const r of SEARCH_ROOTS) walk(join(ROOT, r))

const isTest = (p) => /__tests__|[\\/]e2e[\\/]|\.test\.|\.spec\./.test(p)

// specifier extraction — the four forms, in one regex each
const RE = [
  /\bfrom\s+['"`]([^'"`]+)['"`]/g,
  /\bimport\s+['"`]([^'"`]+)['"`]/g,        // side-effect import
  /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g,   // dynamic
  /\brequire\s*\(\s*['"`]([^'"`]+)['"`]/g,  // cjs
]

/** specifier -> Set(consumer file, repo-relative, posix) */
const consumers = new Map()
const norm = (p) => relative(ROOT, p).split(sep).join('/')

for (const f of files) {
  let src
  try { src = readFileSync(f, 'utf8') } catch { continue }
  const from = norm(f)
  for (const re of RE) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src))) {
      let spec = m[1]
      let target = null
      if (spec.startsWith('@/')) target = spec.slice(2)
      else if (spec.startsWith('.')) target = norm(resolve(dirname(f), spec))
      else if (spec.startsWith('lib/') || spec.startsWith('app/')) target = spec
      if (!target) continue
      target = target.replace(/\.(ts|tsx|js|jsx|mjs)$/, '').replace(/\/index$/, '')
      if (!consumers.has(target)) consumers.set(target, new Set())
      consumers.get(target).add(from)
    }
  }
}

/** Every consumer whose specifier resolves at or below `modPath`. */
function consumersOf(modPath) {
  const out = new Set()
  for (const [spec, set] of consumers) {
    if (spec === modPath || spec.startsWith(modPath + '/')) {
      for (const c of set) {
        if (c.startsWith(modPath + '/') || c === modPath + '.ts' || c === modPath + '.tsx') continue
        if (isTest(c)) continue
        out.add(c)
      }
    }
  }
  return out
}

// ── positive controls: the check must reproduce a known red AND a known green ──
console.log('=== POSITIVE CONTROLS ===')
const controls = [
  ['lib/decision-os/draft-os', 0, 'known DEAD — only a code comment references it'],
  ['lib/fantasycalc-db', null, 'known ALIVE — 36 migrated call sites'],
  ['lib/decision-os/three-brain', null, 'known ALIVE — 6 runtime paths'],
]
let controlsOk = true
for (const [p, expect, why] of controls) {
  const n = consumersOf(p).size
  const pass = expect === null ? n > 0 : n === expect
  if (!pass) controlsOk = false
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${p.padEnd(34)} consumers=${String(n).padEnd(4)} ${why}`)
}
if (!controlsOk) {
  console.log('\n🛑 A CONTROL FAILED. The results below are not evidence. Fix the check first.')
  process.exit(2)
}

// ── candidates ────────────────────────────────────────────────────────────────
const dirs = []
function collectDirs(base, depth) {
  let entries
  try { entries = readdirSync(join(ROOT, base), { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIR.has(e.name) || e.name === '__tests__') continue
    const p = `${base}/${e.name}`
    dirs.push(p)
    if (depth > 1) collectDirs(p, depth - 1)
  }
}
collectDirs('lib', 2)

const dead = []
for (const d of dirs) {
  if (consumersOf(d).size === 0) {
    let n = 0
    try { n = readdirSync(join(ROOT, d)).filter((f) => EXT.test(f)).length } catch {}
    if (n > 0) dead.push([d, n])
  }
}
// drop children whose parent is also dead — report the outermost only
const outermost = dead.filter(([d]) => !dead.some(([o]) => o !== d && d.startsWith(o + '/')))

console.log(`\n=== UNWIRED CANDIDATES: ${outermost.length} directories ===`)
outermost.sort((a, b) => b[1] - a[1])
for (const [d, n] of outermost) console.log(`  ${String(n).padStart(3)} files   ${d}`)
console.log(`\n(scanned ${files.length} files, ${consumers.size} distinct resolved specifiers)`)
