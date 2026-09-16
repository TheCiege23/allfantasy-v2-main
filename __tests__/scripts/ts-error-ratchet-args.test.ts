import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * How `scripts/ts-error-ratchet.mjs` reads its arguments.
 *
 * 🛑 THE BUG THIS PINS: the header documented `--from <log>`, the parser only understood
 * `--from=<log>`, and the documented spelling was silently dropped — so the script ran a fresh
 * full `tsc` of the current tree instead of reading the log, and printed a real-looking verdict
 * about the wrong thing. A planted-error control passed green through it.
 *
 * ⚠ EVERY RUN HERE IS BOUNDED BY A SHORT TIMEOUT, AND THAT IS THE POSITIVE CONTROL. None of
 * these cases should ever start the compiler: each one either reads a fixture log or stops on a
 * usage error. A parser that drops an argument falls through to a full typecheck, which takes
 * minutes on this repo — so it trips the timeout and the case fails, rather than quietly running
 * a real typecheck inside the unit suite.
 *
 * Logs are generated from the COMMITTED baseline, so these tests never depend on the tree's
 * current error count.
 */

const ROOT = resolve(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'ts-error-ratchet.mjs')
const BASELINE_PATH = join(ROOT, 'scripts', 'ts-error-baseline.json')
const REGRESSION_PHRASE = 'gained TypeScript errors'

let dir = ''
let baselineBytes = ''
let cleanLog = ''
let plantedLog = ''
let redraftLog = ''

function logFor(byFile: Record<string, number>, extra: string[] = []): string {
  const lines: string[] = []
  for (const [file, count] of Object.entries(byFile)) {
    for (let i = 0; i < count; i += 1) lines.push(`${file}(${i + 1},1): error TS9999: fixture error.`)
  }
  return [...extra, ...lines, ''].join('\n')
}

function run(args: string[]) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  return {
    status: res.status,
    signal: res.signal,
    output: `${res.stdout ?? ''}\n${res.stderr ?? ''}`,
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ts-ratchet-args-'))
  baselineBytes = readFileSync(BASELINE_PATH, 'utf8')
  const baseline = JSON.parse(baselineBytes) as { byFile: Record<string, number> }

  cleanLog = join(dir, 'clean.log')
  writeFileSync(cleanLog, logFor(baseline.byFile))

  plantedLog = join(dir, 'planted.log')
  writeFileSync(
    plantedLog,
    logFor(baseline.byFile, ['lib/__ratchet_fixture__/planted.ts(10,5): error TS2322: planted.']),
  )

  redraftLog = join(dir, 'redraft.log')
  writeFileSync(
    redraftLog,
    logFor(baseline.byFile, ['lib/redraft/__ratchet_fixture__.ts(1,1): error TS2322: planted.']),
  )
})

afterAll(() => {
  /* No case may rewrite the committed baseline — `--update` is only ever passed malformed here. */
  expect(readFileSync(BASELINE_PATH, 'utf8')).toBe(baselineBytes)
  rmSync(dir, { recursive: true, force: true })
})

describe('--from reads the log in both spellings', () => {
  it('passes a log that matches the baseline', () => {
    const r = run([`--from=${cleanLog}`])
    expect(r.signal).toBeNull()
    expect(r.status).toBe(0)
    expect(r.output).toContain('no regressions')
  })

  it.each([
    ['--from=<log>', () => [`--from=${plantedLog}`]],
    ['--from <log>', () => ['--from', plantedLog]],
  ])('fails on a planted error via %s', (_label, args) => {
    const r = run(args())
    expect(r.signal, 'the script ran a real typecheck instead of reading the log').toBeNull()
    expect(r.status).toBe(1)
    expect(r.output).toContain(REGRESSION_PHRASE)
    expect(r.output).toContain('lib/__ratchet_fixture__/planted.ts: 0 → 1')
  })
})

describe('--scope reads its value in both spellings', () => {
  it.each([
    ['--scope=redraft', () => ['--scope=redraft', `--from=${redraftLog}`]],
    ['--scope redraft', () => ['--scope', 'redraft', '--from', redraftLog]],
  ])('runs the strict gate via %s', (_label, args) => {
    const r = run(args())
    expect(r.signal).toBeNull()
    expect(r.status).toBe(1)
    expect(r.output).toContain('redraft-scoped strict gate')
    expect(r.output).toContain('lib/redraft/__ratchet_fixture__.ts')
  })
})

describe('an argument it cannot use stops it, with no verdict', () => {
  it.each([
    ['--from with no value', ['--from']],
    ['--from followed by another flag', ['--from', '--update']],
    ['--from= with an empty value', ['--from=']],
    ['a misspelt flag', ['--form=whatever.log']],
    ['a stray positional', ['whatever.log']],
    ['an unknown scope', ['--scope', 'everything']],
    ['a boolean flag given a value', ['--update=yes']],
    ['a value flag given twice', ['--from=a.log', '--from=b.log']],
  ])('%s', (_label, args) => {
    const r = run(args)
    expect(r.signal, 'the script fell through to a real typecheck').toBeNull()
    expect(r.status).toBe(2)
    expect(r.output).toContain('ts-error-ratchet:')
    expect(r.output).toContain('No verdict was produced')
    /* pre-push-smoke blocks a push on this phrase; a usage error must never carry it. */
    expect(r.output).not.toContain(REGRESSION_PHRASE)
    expect(r.output).not.toContain('no regressions')
  })

  it('names a --from log that does not exist', () => {
    const missing = join(dir, 'not-there.log')
    const r = run(['--from', missing])
    expect(r.status).toBe(2)
    expect(r.output).toContain('--from log not found')
  })
})
