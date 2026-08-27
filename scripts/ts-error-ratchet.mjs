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
 * ⚠ IT MUST NEVER PASS A RUN THAT CHECKED NOTHING.
 * This script decides by grepping tsc's output for error lines, so anything that stops tsc from
 * emitting them — a compiler it cannot find, a heap OOM, a bad tsconfig — parses as ZERO errors.
 * Until Aug 2026 that was reported as `✓ no regressions, 156 fewer errors` and exit 0: a green
 * gate over a compiler that never type-checked a file, in CI as well as locally. `assertTrustworthy`
 * is the guard; see its comment for the invariant. Do not "simplify" it away, and do not re-baseline
 * on the strength of a sudden improvement without checking tsc actually ran.
 *
 * Usage:
 *   node scripts/ts-error-ratchet.mjs                # check against baseline
 *   node scripts/ts-error-ratchet.mjs --update       # re-snapshot the baseline
 *   node scripts/ts-error-ratchet.mjs --scope=redraft # zero-tolerance redraft gate
 *   node scripts/ts-error-ratchet.mjs --from <log>    # parse an existing tsc log
 *
 * Exit codes: 0 pass · 1 real regression · 2 could not determine (compiler never ran, or no baseline)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative, isAbsolute } from 'node:path'

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

/**
 * A tsc diagnostic with NO file/line prefix -- `error TS5083: Cannot read file 'tsconfig.json'`,
 * `error TS18003: No inputs were found in config file`.
 *
 * These mean tsc started but never built a program, so it type-checked nothing. ERROR_LINE cannot
 * match them (there is no `(line,col)`), which is precisely why they used to read as "0 errors,
 * no regressions" and pass the gate.
 */
const GLOBAL_ERROR_LINE = /^error (TS\d+): (.*)$/

/**
 * Output that means the compiler DIED rather than reported type errors. The heap message is the
 * one this script's own `--max-old-space-size=8192` exists to outrun -- and when it loses, tsc
 * prints this, emits no diagnostics, and exits non-zero.
 *
 * Every entry is PROCESS-level text that cannot appear inside a TypeScript diagnostic. Keep it
 * that way. The obvious-looking `'Cannot find module'` belongs nowhere near this list: it is also
 * the wording of TS2307 (`Cannot find module 'x' or its corresponding type declarations`), a
 * routine type error, so including it would abort the whole run over one unresolved import and
 * blame a compiler crash that never happened. Node's `MODULE_NOT_FOUND` code covers the real case.
 *
 * Checked even when some diagnostics DID parse: an OOM part-way through leaves a truncated report,
 * and a truncated report undercounts errors -- which reads as an improvement and hides a regression.
 */
const CRASH_SIGNATURES = [
  'JavaScript heap out of memory',
  'FATAL ERROR',
  'MODULE_NOT_FOUND',
  'ERR_WORKER_OUT_OF_MEMORY',
  'Segmentation fault',
]

/** Exit code for "the ratchet could not answer the question" -- distinct from 1, a real regression. */
const EXIT_INDETERMINATE = 2

function abort(headline, detail) {
  console.error(`\n✗ ts-error-ratchet: ${headline}`)
  console.error('  The compiler did not produce a trustworthy report, so NOTHING was verified.')
  console.error('  Refusing to report a pass: "type-checked nothing" must never look like "clean".')
  if (detail) console.error(`\n${detail}`)
  process.exit(EXIT_INDETERMINATE)
}

/**
 * Locate the TypeScript compiler by RESOLUTION, not by a hardcoded path.
 *
 * This used to be the literal string `./node_modules/typescript/lib/tsc.js` relative to the repo
 * root. In a git worktree the local node_modules is typically a junction to the main checkout's,
 * and when that junction is empty or broken the path simply does not exist: node exits
 * MODULE_NOT_FOUND, prints nothing that looks like a diagnostic, and the ratchet reported
 * `0 errors (baseline 156) ... ✓ no regressions` and exited 0.
 *
 * Node's own resolution walks up out of the worktree to the real install, so the ratchet works
 * from a worktree instead of silently passing everything in one.
 */
function resolveTscPath() {
  try {
    return createRequire(import.meta.url).resolve('typescript/lib/tsc.js')
  } catch {
    return null
  }
}

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

function runTsc() {
  const from = valOf('--from')
  if (from) {
    return { text: readFileSync(resolve(root, from), 'utf8'), status: null, from }
  }

  const tsc = resolveTscPath()
  if (!tsc) {
    abort(
      'could not resolve the TypeScript compiler.',
      "  `typescript` is not installed anywhere on the resolution path from this script.\n" +
        '  Run `npm ci` (in this checkout, or in the main checkout if this is a worktree).',
    )
  }

  // A worktree with no install of its own borrows the main checkout's compiler. That works, and
  // it is the case that used to produce a false clean, so say it out loud rather than silently.
  const rel = relative(root, tsc)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    console.log(`note: using the TypeScript compiler at ${tsc} (outside this checkout).`)
  }

  const r = spawnSync(
    process.execPath,
    // `--pretty false` pins the `file(line,col): error TSxxxx:` shape ERROR_LINE parses. Pretty
    // output wraps diagnostics in ANSI colour and a different layout, which the regex would miss
    // entirely -- another way to count zero errors in a run that found plenty.
    ['--max-old-space-size=8192', tsc, '--noEmit', '--pretty', 'false'],
    { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  )
  return {
    text: `${r.stdout || ''}${r.stderr || ''}`,
    status: r.status,
    signal: r.signal,
    spawnError: r.error,
    tsc,
  }
}

/**
 * Prove the compiler actually ran before believing a word of its report.
 *
 * THE INVARIANT: a healthy `tsc --noEmit` either exits 0 having found nothing, or exits non-zero
 * having printed at least one `file(line,col): error TS...` line. "Non-zero exit AND zero parsed
 * errors" is not a state tsc can legitimately reach -- it means the compiler crashed, could not
 * start, or died on config before checking a single file.
 *
 * The old code never looked at the exit status at all; it just grepped stdout+stderr for error
 * lines. So every one of those failures parsed as zero errors and was reported as
 * `✓ no regressions. 71 file(s) improved; 156 fewer error(s) overall.` -- a gate that passed a
 * run which type-checked nothing, and helpfully suggested re-baselining the debt away to boot.
 *
 * Observed causes, both live: a worktree whose node_modules junction is empty, and the repo-wide
 * heap OOM (exit 134) this script's --max-old-space-size is trying to outrun.
 */
function assertTrustworthy(run, parsed) {
  if (run.spawnError) {
    abort(`could not start the compiler (${run.spawnError.code || run.spawnError.message}).`)
  }
  if (run.signal) {
    abort(`the compiler was killed by ${run.signal} (commonly the OOM killer).`, tail(run.text))
  }

  const crash = CRASH_SIGNATURES.find((sig) => run.text.includes(sig))
  if (crash) {
    abort(`the compiler crashed -- output contains "${crash}".`, tail(run.text))
  }

  // A config-level diagnostic with no file prefix means no program was built. Fatal only when it
  // is ALL we got; alongside real file errors it is worth surfacing but the file counts still hold.
  const globals = run.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => GLOBAL_ERROR_LINE.test(line))
  if (globals.length > 0 && parsed.total === 0) {
    abort('the compiler reported a config error and type-checked nothing.', globals.map((g) => `  ${g}`).join('\n'))
  }
  if (globals.length > 0) {
    console.warn(`warning: ${globals.length} config-level diagnostic(s) from tsc:`)
    for (const g of globals.slice(0, 5)) console.warn(`  ${g}`)
  }

  // `--from` hands us a log with no exit status, so the invariant below cannot be applied. The
  // crash and config checks above still ran against the log's text.
  if (run.status === null) return

  if (run.status !== 0 && parsed.total === 0) {
    abort(
      `the compiler exited ${run.status} but printed no parseable diagnostics.`,
      tail(run.text) || '  (no output at all)',
    )
  }
  if (run.status === 0 && parsed.total > 0) {
    console.warn(`warning: tsc exited 0 yet ${parsed.total} error line(s) parsed -- treating the parsed errors as real.`)
  }
}

/** Last few lines of compiler output, indented, for an abort message. */
function tail(text, n = 12) {
  const lines = (text || '').split(/\r?\n/).filter((l) => l.trim() !== '')
  return lines.slice(-n).map((l) => `  ${l}`).join('\n')
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
  const run = runTsc()
  const parsed = parse(run.text)
  // Before ANY branch below -- including --update, which would otherwise write a baseline of 0
  // and erase the whole allowlist from a run that checked nothing.
  assertTrustworthy(run, parsed)

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
    process.exit(EXIT_INDETERMINATE)
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
