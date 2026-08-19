#!/usr/bin/env node
/**
 * TypeScript error ratchet.
 *
 * The repo ships with a known, non-zero count of pre-existing `tsc --noEmit`
 * errors (mostly in out-of-scope subsystems: world-cup, brackets, tournament,
 * survivor). Deploys tolerate them via `ignoreBuildErrors`. This ratchet keeps
 * that debt from silently GROWING and lets us drive it down file-by-file:
 *
 *   - default (check):   fail if the total error count rose above the baseline,
 *                        or if any single file gained errors / any new file has
 *                        errors. Never fails just because the count dropped.
 *   - --update:          rewrite the baseline from the current tree (run this
 *                        after you legitimately fix or intentionally add errors).
 *   - --scope=redraft:   ignore the baseline; assert ZERO errors in redraft-scoped
 *                        paths. This is the "redraft-scoped strict gate" — the
 *                        product surface we ARE certifying must stay clean even
 *                        while repo-wide debt is allowlisted by the baseline.
 *
 * Baseline lives at scripts/ts-error-baseline.json (committed).
 *
 * Usage:
 *   node scripts/ts-error-ratchet.mjs                # check against baseline
 *   node scripts/ts-error-ratchet.mjs --update       # re-snapshot the baseline
 *   node scripts/ts-error-ratchet.mjs --scope=redraft # zero-tolerance redraft gate
 *   node scripts/ts-error-ratchet.mjs --from <log>    # parse an existing tsc log
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const BASELINE_PATH = join(root, 'scripts', 'ts-error-baseline.json')

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valOf = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : undefined
}

const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/** A file is "redraft-scoped" if it lives under a redraft path, has `redraft`
 *  in its basename, or is the canonical NFL redraft scoring runtime. */
function isRedraftScoped(file) {
  const base = file.split('/').pop() || ''
  return (
    /\/redraft\//.test(file) ||
    /redraft/i.test(base) ||
    /canonicalNflRedraft/i.test(file)
  )
}

function getTscOutput() {
  const from = valOf('--from')
  if (from) return readFileSync(resolve(root, from), 'utf8')
  const r = spawnSync(
    process.execPath,
    ['--max-old-space-size=8192', './node_modules/typescript/lib/tsc.js', '--noEmit'],
    { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
  )
  return `${r.stdout || ''}${r.stderr || ''}`
}

function parse(text) {
  const byFile = {}
  let total = 0
  for (const line of text.split(/\r?\n/)) {
    const m = ERROR_LINE.exec(line)
    if (!m) continue
    const file = m[1].replace(/\\/g, '/')
    byFile[file] = (byFile[file] || 0) + 1
    total += 1
  }
  return { total, byFile }
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

function writeBaseline(parsed) {
  const ordered = {}
  for (const f of Object.keys(parsed.byFile).sort()) ordered[f] = parsed.byFile[f]
  const payload = {
    _comment:
      'Pre-existing tsc --noEmit error counts, per file. Ratchet fails if any file gains errors or a new file appears. Run `npm run ts:ratchet:update` after legitimately changing the count. DO NOT hand-edit up.',
    total: parsed.total,
    byFile: ordered,
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function main() {
  const parsed = parse(getTscOutput())

  // --- redraft-scoped strict gate -----------------------------------------
  if (valOf('--scope') === 'redraft') {
    const offenders = Object.entries(parsed.byFile)
      .filter(([f]) => isRedraftScoped(f))
      .sort((a, b) => b[1] - a[1])
    const count = offenders.reduce((n, [, c]) => n + c, 0)
    if (count === 0) {
      console.log('✓ redraft-scoped strict gate: 0 TypeScript errors in redraft paths')
      process.exit(0)
    }
    console.error(`✗ redraft-scoped strict gate: ${count} TypeScript error(s) in redraft paths:`)
    for (const [f, c] of offenders) console.error(`    ${c.toString().padStart(3)}  ${f}`)
    process.exit(1)
  }

  // --- re-baseline ---------------------------------------------------------
  if (has('--update')) {
    writeBaseline(parsed)
    console.log(`✓ baseline updated: ${parsed.total} errors across ${Object.keys(parsed.byFile).length} files`)
    process.exit(0)
  }

  // --- ratchet check -------------------------------------------------------
  const baseline = loadBaseline()
  if (!baseline) {
    console.error('No baseline found. Create one with `npm run ts:ratchet:update`.')
    process.exit(2)
  }

  const regressions = []
  for (const [f, c] of Object.entries(parsed.byFile)) {
    const was = baseline.byFile[f] || 0
    if (c > was) regressions.push({ file: f, was, now: c })
  }

  const improvements = []
  for (const [f, was] of Object.entries(baseline.byFile)) {
    const now = parsed.byFile[f] || 0
    if (now < was) improvements.push({ file: f, was, now })
  }

  console.log(`TypeScript errors: ${parsed.total} (baseline ${baseline.total})`)

  if (regressions.length > 0) {
    console.error(`\n✗ ${regressions.length} file(s) gained TypeScript errors:`)
    for (const r of regressions.sort((a, b) => b.now - b.was - (a.now - a.was))) {
      console.error(`    ${r.file}: ${r.was} → ${r.now}  (+${r.now - r.was})`)
    }
    console.error('\nFix the new errors, or if intentional, re-baseline with `npm run ts:ratchet:update`.')
    process.exit(1)
  }

  if (improvements.length > 0 || parsed.total < baseline.total) {
    console.log(`\n✓ no regressions. ${improvements.length} file(s) improved; ${baseline.total - parsed.total} fewer error(s) overall.`)
    console.log('Consider re-baselining to lock in the gains: `npm run ts:ratchet:update`.')
  } else {
    console.log('✓ no regressions.')
  }
  process.exit(0)
}

main()
