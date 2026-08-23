#!/usr/bin/env node
/**
 * Vitest failure ratchet.
 *
 * The repo ships ~110 test files that are already failing on main. Vitest has never run in CI, so
 * that debt accumulated unseen: on 2026-08-20 five tests went red across three merged PRs and
 * nothing reported it. Requiring the suite outright would block every merge in the repo, which is
 * the same trap `playwright.yml` documents for its red core shards.
 *
 * So this does what `ts-error-ratchet.mjs` does for tsc: allowlist the known-bad set, and fail only
 * when the debt GROWS. A file that was passing and starts failing is a regression and blocks. A
 * file that was already failing does not.
 *
 *   - default (check):  fail if a file OUTSIDE the baseline failed. Never fail because a baseline
 *                       file is still failing, and never fail because one got fixed.
 *   - --update:         rewrite the baseline from this run. Run against the FULL suite, not a
 *                       shard, or you will delete every other shard's entries.
 *   - --merge=a,b,c     combine shard result files into the baseline. This is how the baseline is
 *                       built from CI, where the suite is sharded four ways.
 *
 * Baseline lives at scripts/vitest-failure-baseline.json (committed).
 *
 * ⚠ ONLY JUDGES FILES THIS RUN ACTUALLY EXECUTED. Under `--shard` each job sees a quarter of the
 * suite, so a shard must not conclude that the three quarters it never ran have been fixed.
 *
 * Usage:
 *   node scripts/vitest-ratchet.mjs --shard=1/4          # check one shard against the baseline
 *   node scripts/vitest-ratchet.mjs --update             # re-snapshot from a full local run
 *   node scripts/vitest-ratchet.mjs --merge=s1.json,s2.json,s3.json,s4.json
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative } from 'node:path'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const BASELINE_PATH = join(root, 'scripts', 'vitest-failure-baseline.json')

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valOf = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : undefined
}

/** Repo-relative, forward slashes. Vitest reports absolute OS-native paths; a baseline keyed on
 *  those would never match between a Windows checkout and a Linux runner. */
function normalize(p) {
  return relative(root, p).split('\\').join('/')
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    return new Set(raw.failingFiles || [])
  } catch {
    return null
  }
}

function writeBaseline(files, note) {
  const payload = {
    // Deliberately no timestamp: a regenerated-but-identical baseline should produce an empty
    // diff, not churn. `ts-error-baseline.json` behaves the same way.
    note:
      note ||
      'Test files already failing when the vitest ratchet was introduced. Shrink this list; never grow it.',
    count: files.length,
    failingFiles: [...files].sort(),
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return payload
}

/** Run vitest and return { ran, failed } as normalized path sets. */
function runVitest(passthrough) {
  const out = join(mkdtempSync(join(tmpdir(), 'vitest-ratchet-')), 'results.json')
  const argv = [
    'vitest',
    'run',
    '--reporter=json',
    `--outputFile=${out}`,
    // Integration tests need a live Postgres; a unit gate that needs a database fails for reasons
    // unrelated to the code under review.
    '--exclude',
    '**/*.integration.test.ts',
    ...passthrough,
  ]
  // Vitest exits non-zero when tests fail, which is the normal case here -- the ratchet decides
  // whether that matters, so its exit code is deliberately ignored.
  spawnSync('npx', argv, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })

  if (!existsSync(out)) {
    console.error('[vitest-ratchet] vitest produced no JSON output — treating as infrastructure failure')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(out, 'utf8'))
  const ran = new Set()
  const failed = new Set()
  for (const r of data.testResults || []) {
    if (!r?.name) continue
    const rel = normalize(r.name)
    ran.add(rel)
    if (r.status === 'failed') failed.add(rel)
  }
  return { ran, failed }
}

function main() {
  // --merge: build the baseline from shard artifacts produced by CI.
  const merge = valOf('--merge')
  if (merge) {
    const all = new Set()
    for (const f of merge.split(',').map((s) => s.trim()).filter(Boolean)) {
      const d = JSON.parse(readFileSync(f, 'utf8'))
      for (const p of d.failed || []) all.add(p)
    }
    const written = writeBaseline([...all])
    console.log(`[vitest-ratchet] baseline written from ${merge.split(',').length} shard file(s): ${written.count} failing files`)
    return
  }

  // Bare (non-flag) args are path filters, exactly as vitest treats them. Useful for scoping a
  // local check to one directory instead of the whole ~1,600-file suite.
  const passthrough = [
    ...args.filter((a) => a.startsWith('--shard=')),
    ...args.filter((a) => !a.startsWith('--')),
  ]
  const { ran, failed } = runVitest(passthrough)

  // Always emit this run's result, so the baseline can be rebuilt from CI without scraping logs.
  // Scraping was tried first and is not reliable: GitHub truncates a large failed-job log, and one
  // shard's summary was cut off entirely, which would have produced a baseline missing a quarter of
  // its entries -- worse than no ratchet, because every missing file reads as a fresh regression.
  const shardOut = join(root, `vitest-ratchet-result.json`)
  writeFileSync(shardOut, JSON.stringify({ ran: [...ran].sort(), failed: [...failed].sort() }, null, 2) + '\n', 'utf8')
  console.log(`[vitest-ratchet] ran ${ran.size} files, ${failed.size} failed → ${relative(root, shardOut)}`)

  if (has('--update')) {
    if (passthrough.some((a) => a.startsWith('--shard='))) {
      console.error('[vitest-ratchet] --update with --shard would delete the other shards\u2019 entries. Use --merge instead.')
      process.exit(1)
    }
    const written = writeBaseline([...failed])
    console.log(`[vitest-ratchet] baseline updated: ${written.count} failing files`)
    return
  }

  const baseline = readBaseline()
  if (!baseline) {
    // Fail OPEN while bootstrapping: a ratchet with no baseline would call all ~110 known failures
    // regressions and block every merge, which is the exact outcome it exists to avoid.
    console.log('[vitest-ratchet] no baseline at scripts/vitest-failure-baseline.json — ADVISORY ONLY.')
    console.log('[vitest-ratchet] build one with --merge once every shard has reported.')
    return
  }

  // Judge ONLY files this run executed. Under --shard the other three quarters were never run and
  // must not be mistaken for fixed.
  const regressions = [...failed].filter((f) => !baseline.has(f)).sort()
  const fixed = [...baseline].filter((f) => ran.has(f) && !failed.has(f)).sort()

  if (fixed.length) {
    console.log(`\n[vitest-ratchet] ${fixed.length} baseline file(s) now PASS — tighten the ratchet by removing them:`)
    for (const f of fixed) console.log(`  ✓ ${f}`)
  }

  if (regressions.length) {
    console.error(`\n[vitest-ratchet] ${regressions.length} file(s) were passing and now FAIL:`)
    for (const f of regressions) console.error(`  ✗ ${f}`)
    console.error('\nThese are regressions, not pre-existing debt. Fix them, or if the failure is')
    console.error('intentional, add the file to scripts/vitest-failure-baseline.json in the same change')
    console.error('and say why in the commit message.')
    process.exit(1)
  }

  console.log(`\n[vitest-ratchet] OK — no new failing files (${failed.size} failing, all allowlisted).`)
}

main()
