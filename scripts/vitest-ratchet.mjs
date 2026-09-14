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
import { judge, summarizeRun } from './vitest-ratchet-judge.mjs'

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

/**
 * Vitest's own failure output, per file, for the summary and the uploaded artifact.
 *
 * WITHOUT THIS, A FAILURE IS A FILENAME AND NOTHING ELSE. `--reporter=json` REPLACES the console
 * reporter, so a failing file produced no FAIL line, no assertion and no stack -- the job log named
 * the file once and said nothing more. Four separate investigations into shard 4/4 ended right
 * there, because the only artifact that survives a rerun (vitest-ratchet-result.json) recorded
 * names and threw away every message the report already contained.
 *
 * Kept SHORT on purpose: enough to tell an assertion apart from a dead worker, not a full stack.
 */
function collectErrors(result) {
  const out = []
  for (const a of result.assertionResults || []) {
    if (a && a.status === 'failed') {
      const msg = (a.failureMessages || []).join(' | ').replace(/\s+/g, ' ').trim()
      out.push(((a.fullName || a.title || '(unnamed)') + ': ' + msg).slice(0, 300))
    }
  }
  // A file can fail with NO failing assertion -- an import that threw, or a worker that died
  // mid-file. That is the shape shard 4 keeps producing, and it is the case worth naming loudest.
  if (out.length === 0) {
    const top = String(result.message || '').replace(/\s+/g, ' ').trim()
    out.push(
      top
        ? ('file-level failure: ' + top).slice(0, 300)
        : 'file-level failure with NO assertion error and NO message -- the file did not complete (worker died, or an import threw)',
    )
  }
  return out
}

/**
 * Run vitest and summarize what every scheduled file did: `{ scheduled, ran, failed, errors,
 * incomplete, unhandled }` — see summarizeRun in vitest-ratchet-judge.mjs.
 */
function runVitest(passthrough) {
  const dir = mkdtempSync(join(tmpdir(), 'vitest-ratchet-'))
  const out = join(dir, 'results.json')
  const record = join(dir, 'run-record.json')
  const reporter = join(root, 'scripts', 'vitest-ratchet-reporter.mjs').split('\\').join('/')
  const argv = [
    'vitest',
    'run',
    // `json` feeds the ratchet; `default` puts the human-readable failure back in the job log, where
    // it was missing entirely.
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${out}`,
    // 🛑 AND THE RUN RECORD, BECAUSE THE JSON REPORT CANNOT SEE A FILE THAT NEVER FINISHED. A worker
    // killed mid-file is written there as "passed", and unhandled errors are not written at all.
    // CI shard 2/4 of run 34855366587 lost a whole file that way and this script said "OK".
    `--reporter=${reporter}`,
    // Integration tests need a live Postgres; a unit gate that needs a database fails for reasons
    // unrelated to the code under review.
    '--exclude',
    '**/*.integration.test.ts',
    ...passthrough,
  ]
  // Vitest exits non-zero when tests fail, which is the normal case here -- the ratchet decides
  // whether that matters, so its exit code is deliberately ignored. That is safe only because the
  // run record below carries the crash and unhandled-error signal the exit code would have.
  spawnSync('npx', argv, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, VITEST_RATCHET_RUN_RECORD: record },
  })

  if (!existsSync(out)) {
    console.error('[vitest-ratchet] vitest produced no JSON output — treating as infrastructure failure')
    process.exit(1)
  }
  if (!existsSync(record)) {
    console.error('[vitest-ratchet] the ratchet reporter wrote no run record — treating as infrastructure failure')
    process.exit(1)
  }
  return summarizeRun({
    jsonReport: JSON.parse(readFileSync(out, 'utf8')),
    runRecord: JSON.parse(readFileSync(record, 'utf8')),
    // resolve() first: vitest reports absolute paths, but an error's VITEST_TEST_PATH may not be.
    toRel: (p) => normalize(resolve(root, p)),
    collectErrors,
  })
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
  const summary = runVitest(passthrough)
  const { scheduled, ran, failed, errors, incomplete, unhandled } = summary
  const incompleteCount = Object.keys(incomplete).length

  // Always emit this run's result, so the baseline can be rebuilt from CI without scraping logs.
  // Scraping was tried first and is not reliable: GitHub truncates a large failed-job log, and one
  // shard's summary was cut off entirely, which would have produced a baseline missing a quarter of
  // its entries -- worse than no ratchet, because every missing file reads as a fresh regression.
  const shardOut = join(root, `vitest-ratchet-result.json`)
  // `errors` rides along BECAUSE THIS FILE IS THE ONLY THING THAT SURVIVES A RERUN. `gh run rerun`
  // overwrites both the job conclusion and the log, so a flake investigated after the fact has no
  // evidence left anywhere else -- which is exactly how four shard-4 failures went undiagnosed.
  // `incomplete` and `unhandled` ride along for the same reason: a dead worker leaves nothing else.
  writeFileSync(
    shardOut,
    JSON.stringify(
      { ran: [...ran].sort(), failed: [...failed].sort(), errors, incomplete, unhandled },
      null,
      2,
    ) + '\n',
    'utf8',
  )
  console.log(
    `[vitest-ratchet] scheduled ${scheduled.size} files: ${ran.size} finished, ${failed.size} failed, ` +
      `${incompleteCount} did not finish, ${unhandled.length} unhandled error(s) → ${relative(root, shardOut)}`,
  )

  if (has('--update')) {
    if (passthrough.some((a) => a.startsWith('--shard='))) {
      console.error('[vitest-ratchet] --update with --shard would delete the other shards\u2019 entries. Use --merge instead.')
      process.exit(1)
    }
    if (incompleteCount || unhandled.length) {
      // A baseline records FAILING files. A file that never finished is neither passing nor
      // failing, so a snapshot of this run would describe a suite nobody actually ran.
      console.error('[vitest-ratchet] refusing --update: this run had files that did not finish or unhandled errors.')
      console.error('[vitest-ratchet] fix the crash first; a baseline cannot represent a file that never reported.')
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

  // Judge ONLY files this run scheduled. Under --shard the other three quarters were never run and
  // must not be mistaken for fixed — or for missing.
  const verdict = judge({ baseline, summary })

  if (verdict.fixed.length) {
    console.log(`\n[vitest-ratchet] ${verdict.fixed.length} baseline file(s) now PASS — tighten the ratchet by removing them:`)
    for (const f of verdict.fixed) console.log(`  ✓ ${f}`)
  }

  if (!verdict.ok) {
    // ⚠ KEEP "were passing and now FAIL" IN THIS LINE. scripts/pre-push-smoke.mjs classifies this
    // script's output by that phrase: without it, a crashed file would read as an inconclusive run
    // and the push guard would fail OPEN on exactly the case this change exists to catch.
    console.error(
      `\n[vitest-ratchet] ${verdict.regressions.length} file(s) were passing and now FAIL, did not finish, ` +
        `or leaked an unhandled error; ${verdict.runErrors.length} unattributed unhandled error(s):`,
    )
    // Print WHY, not just which. A bare filename cannot distinguish an assertion someone broke
    // from a worker that died, and those need opposite responses: fix the code, or investigate the
    // runner. Four investigations stalled on exactly this distinction.
    for (const r of verdict.regressions) {
      console.error(`  ✗ ${r.file}`)
      for (const why of r.reasons) console.error(`      ${why}`)
    }
    for (const why of verdict.runErrors) console.error(`  ✗ (no file) ${why}`)
    console.error('\nA newly failing file is a regression, not pre-existing debt. Fix it, or if the failure is')
    console.error('intentional, add the file to scripts/vitest-failure-baseline.json in the same change')
    console.error('and say why in the commit message.')
    console.error('A file that did not finish, or an unhandled error, is never excused by the baseline: its')
    console.error('tests may not have run at all. Find the crash, hang or leak.')
    process.exit(1)
  }

  console.log(
    `\n[vitest-ratchet] OK — every scheduled file finished, no unhandled errors, no new failing files ` +
      `(${failed.size} failing, all allowlisted).`,
  )
}

main()
