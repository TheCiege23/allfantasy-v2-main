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
 * Usage (value flags take `--flag value` or `--flag=value`):
 *   node scripts/ts-error-ratchet.mjs                  # check against baseline
 *   node scripts/ts-error-ratchet.mjs --update         # re-snapshot the baseline
 *   node scripts/ts-error-ratchet.mjs --scope redraft  # zero-tolerance redraft gate
 *   node scripts/ts-error-ratchet.mjs --from <log>     # parse an existing tsc log
 *   node scripts/ts-error-ratchet.mjs --allow-zero     # accept a genuine zero-error run
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const BASELINE_PATH = join(root, 'scripts', 'ts-error-baseline.json')

/*
 * ── ARGUMENTS ─────────────────────────────────────────────────────────────────
 *
 * 🛑 AN ARGUMENT THIS SCRIPT DOES NOT UNDERSTAND MUST STOP IT, NOT BE SKIPPED.
 *
 * The header documented `--from <log>`, and the parser only matched `--from=<log>`. So the
 * documented spelling was dropped on the floor: no log was read, the script fell through to a
 * fresh full `tsc` of the current tree, and printed an honest-looking verdict about something
 * the caller never asked about. Measured 2026-09-16: a log with one planted error passed as
 * "143 (baseline 143) ✓ no regressions" via `--from <log>`, and failed correctly via
 * `--from=<log>`. A positive control built on that log read green for the wrong reason — the
 * check-that-cannot-fail shape CLAUDE.md spends pages on, reached through argv. `--scope redraft`
 * was dropped the same way, and quietly ran the full ratchet instead of the strict gate.
 *
 * So: both spellings for value flags, and anything else — an unknown flag, a typo, a value flag
 * with no value, a stray positional — is a usage error. Exit 2, the same code the script already
 * uses for "this run is not a verdict", and never a message containing the regression phrase
 * `pre-push-smoke.mjs` matches on, so a usage error can only ever read as inconclusive there.
 */
const VALUE_FLAGS = new Set(['--from', '--scope'])
const BOOLEAN_FLAGS = new Set(['--update', '--allow-zero'])
const SCOPES = new Set(['redraft'])

function usageError(message) {
  console.error(
    `✗ ts-error-ratchet: ${message}\n` +
      '  Usage: node scripts/ts-error-ratchet.mjs [--update] [--allow-zero] [--scope redraft] [--from <tsc log>]\n' +
      '  Value flags accept `--flag value` or `--flag=value`. No verdict was produced.',
  )
  process.exit(2)
}

function parseArgs(argv) {
  const flags = new Set()
  const values = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)

    if (VALUE_FLAGS.has(name)) {
      let value
      if (eq !== -1) {
        value = arg.slice(eq + 1)
      } else {
        value = argv[i + 1]
        /* A following flag is not a value: `--from --update` means the log path was forgotten. */
        if (value !== undefined && value.startsWith('--')) value = undefined
        else i += 1
      }
      if (!value) usageError(`${name} needs a value`)
      if (values.has(name)) usageError(`${name} was given more than once`)
      values.set(name, value)
      continue
    }

    if (BOOLEAN_FLAGS.has(name) && eq === -1) {
      flags.add(name)
      continue
    }

    usageError(`unrecognised argument: ${arg}`)
  }

  const scope = values.get('--scope')
  if (scope !== undefined && !SCOPES.has(scope)) {
    usageError(`unknown --scope "${scope}" (known: ${[...SCOPES].join(', ')})`)
  }
  return { flags, values }
}

const parsedArgs = parseArgs(process.argv.slice(2))
const has = (f) => parsedArgs.flags.has(f)
const valOf = (name) => parsedArgs.values.get(name)

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
  if (from) {
    const path = resolve(root, from)
    /* A missing log is a usage error, not a crash whose ENOENT stack reads like an infra fault. */
    if (!existsSync(path)) usageError(`--from log not found: ${path}`)
    return readFileSync(path, 'utf8')
  }
  const r = spawnSync(
    process.execPath,
    ['--max-old-space-size=8192', './node_modules/typescript/lib/tsc.js', '--noEmit'],
    { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
  )

  /*
   * ⚠ A COMPILER THAT NEVER RAN LOOKS EXACTLY LIKE A CLEAN ONE.
   *
   * This used to `return ${r.stdout}${r.stderr}` with no check at all. Every way tsc can
   * fail to produce a real analysis — spawn failure, OOM kill, maxBuffer overflow —
   * yields empty or truncated output, which parses to ZERO errors. Zero then satisfies
   * "no file gained errors" and the gate PASSES. `--update` is worse: it would overwrite
   * the committed baseline with nothing, silently retiring the ratchet for everyone.
   *
   * Observed 2026-08-28: `npx tsc --noEmit` returned exit 127 with zero bytes under heavy
   * machine load, and the wrapper reported success. The only reason it was caught was a
   * positive control — asking the run to reproduce the KNOWN error count and noticing it
   * came back 0. That control is now encoded below rather than left to whoever remembers.
   *
   * ⚠ tsc EXITS 2 WHEN IT FINDS ERRORS — that is "diagnostics were reported", its normal
   * errors-found path, NOT a failure to run. The first version of this guard allowed only
   * 0 and 1 and therefore rejected every ordinary run of a repo that carries known errors,
   * i.e. this one. It was caught within the hour by dogfooding the ratchet on a real
   * change, but it was live on main and would have failed CI for everybody.
   *
   * Accepted: 0 (clean), 1, 2 (errors reported). Rejected: 3+ (config/project errors —
   * the check never analysed the code), any signal kill, and a spawn failure. 134 and 137
   * land in that rejected set, which is the heap-OOM false clean this exists to stop.
   *
   * Note the ACCEPTED set is deliberately generous, because status is the weak signal
   * here: the anti-vacuity check below is what actually distinguishes a real run from a
   * broken one, and it does so without having to enumerate a compiler's exit codes
   * correctly. Being wrong in this direction fails a working build; being wrong in the
   * other direction passes a broken one. Neither is acceptable, so the two guards cover
   * each other.
   */
  if (r.error) {
    throw new Error(`tsc failed to start: ${r.error.message}`)
  }
  if (r.signal) {
    throw new Error(`tsc was killed by signal ${r.signal} — the check did not complete`)
  }
  if (r.status !== 0 && r.status !== 1 && r.status !== 2) {
    const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).slice(-5).join('\n')
    throw new Error(
      `tsc exited ${r.status}; 0/1/2 are the codes that mean it actually ran.\n${tail}`
    )
  }
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

  /*
   * ANTI-VACUITY: the positive control, encoded.
   *
   * The spawn guards above catch a compiler that crashed. They cannot catch one that ran
   * and produced output this script failed to PARSE — a tsc format change, a locale that
   * localises the word "error", a `--from` log pointing at the wrong file. Every one of
   * those also yields zero errors and a passing gate.
   *
   * ⚠ NOR ARE THE STATUS GUARDS ENOUGH ON THEIR OWN, measured rather than assumed: point
   * the spawn at a module that does not exist and node exits **1** — which is tsc's own
   * "errors found" code, so `r.status` sails through. THIS check is what caught that case
   * in testing. If you are ever tempted to drop it as belt-and-braces, that is the
   * scenario you would be re-opening.
   *
   * So: if the committed baseline says this repo has known errors and we just found NONE,
   * disbelieve the run. Reaching genuine zero is possible and welcome, which is why there
   * is an explicit opt-out rather than a hard stop — but it must be a deliberate claim by
   * a human, not the default reading of an empty buffer.
   */
  const baselineForSanity = loadBaseline()
  if (
    baselineForSanity &&
    baselineForSanity.total > 0 &&
    parsed.total === 0 &&
    !has('--allow-zero')
  ) {
    console.error(
      `✗ tsc reported 0 errors but the baseline records ${baselineForSanity.total}.\n` +
        '  A check that cannot fail is worse than no check, so this is treated as a BROKEN RUN,\n' +
        '  not a clean one. Usual causes: the compiler did not really run, or its output was not\n' +
        '  parsed. If the repo has genuinely reached zero, re-run with --allow-zero (and then\n' +
        '  `npm run ts:ratchet:update` to re-snapshot).'
    )
    process.exit(2)
  }

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
