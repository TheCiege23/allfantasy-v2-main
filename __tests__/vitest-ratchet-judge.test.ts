import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { judge, summarizeRun, toRunRecord } from '../scripts/vitest-ratchet-judge.mjs'

/**
 * The ratchet's verdict on a run.
 *
 * 🛑 THE CASE THIS EXISTS FOR IS A FILE VITEST CALLS "PASSED" THAT NEVER FINISHED. On vitest 4.1.5 a
 * worker killed mid-file is written to the JSON report as `status: "passed"` with every assertion
 * `pending`, and unhandled errors are not in that report at all. CI run 34855366587 shard 2/4
 * lost core-rail-active-league.test.tsx that way and the ratchet printed "0 failed … OK".
 */

const toRel = (p: string) => p.replace(/^\/repo\//, '')
const collectErrors = (r: { assertionResults?: { status: string; title: string }[] }) =>
  (r.assertionResults || []).filter((a) => a.status === 'failed').map((a) => `${a.title}: boom`)

function jsonFile(name: string, status: 'passed' | 'failed', assertions: [string, string][]) {
  return {
    name: `/repo/${name}`,
    status,
    message: '',
    assertionResults: assertions.map(([title, s]) => ({ title, status: s })),
  }
}

/** The shape measured from a real run: SIGKILL in one file, an unhandled rejection in another. */
function crashRun() {
  const jsonReport = {
    testResults: [
      jsonFile('__tests__/pass.test.ts', 'passed', [['passes', 'passed']]),
      jsonFile('__tests__/baseline-red.test.ts', 'failed', [['known bad', 'failed']]),
      jsonFile('__tests__/killed.test.ts', 'passed', [
        ['passes first', 'pending'],
        ['kills its own worker', 'pending'],
      ]),
      jsonFile('__tests__/leaks.test.ts', 'passed', [['passes', 'passed']]),
    ],
  }
  const runRecord = toRunRecord(
    ['pass', 'baseline-red', 'killed', 'leaks', 'never-collected'].map((n) => ({
      moduleId: `/repo/__tests__/${n}.test.ts`,
    })),
    [
      { moduleId: '/repo/__tests__/pass.test.ts', state: () => 'passed' },
      { moduleId: '/repo/__tests__/baseline-red.test.ts', state: () => 'failed' },
      { moduleId: '/repo/__tests__/killed.test.ts', state: () => 'pending' },
      { moduleId: '/repo/__tests__/leaks.test.ts', state: () => 'passed' },
    ],
    [
      {
        type: 'Unhandled Rejection',
        message: 'late rejection',
        VITEST_TEST_PATH: '/repo/__tests__/leaks.test.ts',
        VITEST_TEST_NAME: 'passes',
      },
      { type: 'Unhandled Error', message: '[vitest-pool]: Worker forks emitted error.' },
    ],
    'failed',
  )
  return summarizeRun({ jsonReport, runRecord, toRel, collectErrors })
}

describe('toRunRecord', () => {
  it('keeps scheduled files, module states and unhandled errors with their file when vitest names one', () => {
    const record = toRunRecord(
      [{ moduleId: '/repo/a.test.ts' }],
      [{ moduleId: '/repo/a.test.ts', state: () => 'pending' }, { moduleId: '/repo/b.test.ts', state: () => { throw new Error('x') } }],
      [{ type: 'Unhandled Rejection', message: 'late\n  rejection', VITEST_TEST_PATH: '/repo/a.test.ts' }, { name: 'Error', message: 'pool' }],
      'failed',
    )
    expect(record.scheduled).toEqual(['/repo/a.test.ts'])
    expect(record.modules).toEqual([
      { moduleId: '/repo/a.test.ts', state: 'pending' },
      { moduleId: '/repo/b.test.ts', state: 'unknown' },
    ])
    expect(record.unhandled[0]).toMatchObject({ type: 'Unhandled Rejection', message: 'late rejection', testPath: '/repo/a.test.ts' })
    expect(record.unhandled[1]).toMatchObject({ type: 'Error', message: 'pool', testPath: null })
  })
})

describe('summarizeRun', () => {
  it('does not count a killed file as run, even though the JSON report calls it passed', () => {
    const s = crashRun()
    expect(s.ran.has('__tests__/killed.test.ts')).toBe(false)
    expect(s.failed.has('__tests__/killed.test.ts')).toBe(false)
    expect(s.incomplete['__tests__/killed.test.ts']).toMatch(/did not finish \(state "pending"\)/)
  })

  it('flags a scheduled file that reported no result at all', () => {
    expect(crashRun().incomplete['__tests__/never-collected.test.ts']).toMatch(/scheduled but reported no result/)
  })

  it('treats a module vitest marks failed as failed when the JSON report has no failing assertion', () => {
    const s = summarizeRun({
      jsonReport: { testResults: [jsonFile('__tests__/import-threw.test.ts', 'passed', [])] },
      runRecord: toRunRecord([{ moduleId: '/repo/__tests__/import-threw.test.ts' }], [{ moduleId: '/repo/__tests__/import-threw.test.ts', state: () => 'failed' }], [], 'failed'),
      toRel,
      collectErrors,
    })
    expect(s.failed.has('__tests__/import-threw.test.ts')).toBe(true)
    expect(s.ran.has('__tests__/import-threw.test.ts')).toBe(true)
  })
})

describe('judge', () => {
  const baseline = new Set(['__tests__/baseline-red.test.ts', '__tests__/killed.test.ts'])

  it('fails the crash run, naming every file and the pool error', () => {
    const v = judge({ baseline, summary: crashRun() })
    expect(v.ok).toBe(false)
    expect(v.regressions.map((r) => r.file)).toEqual([
      '__tests__/killed.test.ts',
      '__tests__/leaks.test.ts',
      '__tests__/never-collected.test.ts',
    ])
    expect(v.regressions.find((r) => r.file === '__tests__/leaks.test.ts')?.reasons).toEqual([
      'unhandled Unhandled Rejection: late rejection',
    ])
    expect(v.runErrors).toEqual(['unhandled Unhandled Error: [vitest-pool]: Worker forks emitted error.'])
  })

  it('does not let a baseline entry excuse a file that never finished', () => {
    const v = judge({ baseline, summary: crashRun() })
    expect(v.regressions.some((r) => r.file === '__tests__/killed.test.ts')).toBe(true)
    expect(v.fixed).not.toContain('__tests__/killed.test.ts')
  })

  it('still passes a run whose only failure is baseline-listed', () => {
    const summary = summarizeRun({
      jsonReport: {
        testResults: [
          jsonFile('__tests__/pass.test.ts', 'passed', [['passes', 'passed']]),
          jsonFile('__tests__/baseline-red.test.ts', 'failed', [['known bad', 'failed']]),
        ],
      },
      runRecord: toRunRecord(
        [{ moduleId: '/repo/__tests__/pass.test.ts' }, { moduleId: '/repo/__tests__/baseline-red.test.ts' }],
        [
          { moduleId: '/repo/__tests__/pass.test.ts', state: () => 'passed' },
          { moduleId: '/repo/__tests__/baseline-red.test.ts', state: () => 'failed' },
        ],
        [],
        'failed',
      ),
      toRel,
      collectErrors,
    })
    expect(judge({ baseline, summary })).toEqual({ regressions: [], runErrors: [], fixed: [], ok: true })
  })

  it('reports a new failure with its assertion message, and a baseline file that now passes as fixed', () => {
    const summary = summarizeRun({
      jsonReport: {
        testResults: [
          jsonFile('__tests__/new-red.test.ts', 'failed', [['broke', 'failed']]),
          jsonFile('__tests__/baseline-red.test.ts', 'passed', [['known bad', 'passed']]),
        ],
      },
      runRecord: toRunRecord(
        [{ moduleId: '/repo/__tests__/new-red.test.ts' }, { moduleId: '/repo/__tests__/baseline-red.test.ts' }],
        [
          { moduleId: '/repo/__tests__/new-red.test.ts', state: () => 'failed' },
          { moduleId: '/repo/__tests__/baseline-red.test.ts', state: () => 'passed' },
        ],
        [],
        'failed',
      ),
      toRel,
      collectErrors,
    })
    const v = judge({ baseline, summary })
    expect(v.regressions).toEqual([{ file: '__tests__/new-red.test.ts', reasons: ['broke: boom'] }])
    expect(v.fixed).toEqual(['__tests__/baseline-red.test.ts'])
  })

  it('fails a run whose only finding is a baseline file that now passes (stale entry)', () => {
    const summary = summarizeRun({
      jsonReport: { testResults: [jsonFile('__tests__/baseline-red.test.ts', 'passed', [['known bad', 'passed']])] },
      runRecord: toRunRecord(
        [{ moduleId: '/repo/__tests__/baseline-red.test.ts' }],
        [{ moduleId: '/repo/__tests__/baseline-red.test.ts', state: () => 'passed' }],
        [],
        'passed',
      ),
      toRel,
      collectErrors,
    })
    expect(judge({ baseline, summary })).toEqual({
      regressions: [],
      runErrors: [],
      fixed: ['__tests__/baseline-red.test.ts'],
      ok: false,
    })
  })

  it('judges only what the run scheduled, so a shard never reports the other shards missing', () => {
    const summary = summarizeRun({
      jsonReport: { testResults: [jsonFile('__tests__/pass.test.ts', 'passed', [['passes', 'passed']])] },
      runRecord: toRunRecord([{ moduleId: '/repo/__tests__/pass.test.ts' }], [{ moduleId: '/repo/__tests__/pass.test.ts', state: () => 'passed' }], [], 'passed'),
      toRel,
      collectErrors,
    })
    const v = judge({ baseline, summary })
    expect(v.ok).toBe(true)
    expect(v.fixed).toEqual([])
  })
})

/*
 * The committed baseline itself. The judge can only call an entry stale when the file RUNS: a
 * deleted test file never runs, so it can never be reported as passing and would sit in the
 * allowlist forever (`commissioner-intelligence-preview` did, after its suite was retired).
 * And `count` drifted from the list it counts. Both are checked here, plus a triage reason per
 * entry, so "why is this allowed to fail" always has an answer in the file.
 */
describe('scripts/vitest-failure-baseline.json', () => {
  const baselineFile = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'vitest-failure-baseline.json'), 'utf8')) as {
    count: number
    failingFiles: string[]
    reasons?: Record<string, string>
  }

  it('has a count that matches its list, and no duplicates', () => {
    expect(baselineFile.count).toBe(baselineFile.failingFiles.length)
    expect(new Set(baselineFile.failingFiles).size).toBe(baselineFile.failingFiles.length)
  })

  it('lists only test files that exist', () => {
    const missing = baselineFile.failingFiles.filter((f) => !existsSync(join(process.cwd(), f)))
    expect(missing).toEqual([])
  })

  it('gives every entry a triage reason, and no reason outlives its entry', () => {
    const reasons = baselineFile.reasons ?? {}
    const unexplained = baselineFile.failingFiles.filter((f) => !reasons[f]?.trim() || /^UNTRIAGED/.test(reasons[f]))
    expect(unexplained).toEqual([])
    expect(Object.keys(reasons).filter((f) => !baselineFile.failingFiles.includes(f))).toEqual([])
  })
})
