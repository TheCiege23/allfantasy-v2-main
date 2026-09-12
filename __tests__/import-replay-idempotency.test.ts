// @vitest-environment node
/**
 * P1 item 8 of the six-provider import audit: "Add replay tests proving that
 * importing the same payload twice creates zero new records."
 *
 * 🛑 THE CLAIM WAS TRUE ON ONE PATH AND FALSE ON THE OTHER, which is why this
 * file exists at all rather than just ratifying what was already there.
 *
 *   - An ORDINARY re-import short-circuits: `persistImportWithCanonicalAudit`
 *     returns early on a `completed` run with a league, before doing any work.
 *     Zero new records, and nothing needed fixing.
 *
 *   - A FORCED re-import — `allowUpdateExisting: true`, i.e. an actual refresh,
 *     which is the everyday case — skipped that short-circuit and REUSED the
 *     `ImportRun` row. Reuse is correct and deliberate (deleting the run would
 *     discard the audit trail; salting the key would leave unbounded
 *     near-duplicates). But nothing cleared what hangs off the reused row, and
 *     neither `ImportWarning` nor `ImportReviewTask` has a unique constraint,
 *     and both were written with a bare `create`. So every refresh appended
 *     another full copy of that league's warnings, forever.
 *
 * ⚠ THESE TESTS ARE WRITTEN AGAINST A COUNTING STORE, NOT `toHaveBeenCalled`.
 * A call-count assertion would pass against a writer that calls `create` twice
 * and a database that happens to dedupe, and fail against one that legitimately
 * rewrites a row — neither of which is the question. "Zero NEW RECORDS" is a
 * statement about rows, so the double records rows: `create` appends,
 * `deleteMany` removes matching ones, and the test compares table sizes across
 * two runs of the same payload.
 *
 * ⚠ AND THE FIX IS DELETE-THEN-CREATE, NOT A UNIQUE CONSTRAINT, DELIBERATELY.
 * An `@@unique` would need a migration, and a migration is not landable work —
 * it belongs to the user. These tests therefore assert CONVERGENCE (the table
 * is the same size after the second run) rather than any particular mechanism,
 * so adding a constraint later keeps them passing instead of rewriting them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>

/** A minimal relational double: rows per table, with the three operations under test. */
class Store {
  tables = new Map<string, Row[]>()

  private t(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, [])
    return this.tables.get(name)!
  }

  count(name: string): number {
    return this.t(name).length
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.tables.entries()].map(([k, v]) => [k, v.length]))
  }

  create(name: string, data: Row): Row {
    const row = { id: `${name}-${this.t(name).length + 1}`, ...data }
    this.t(name).push(row)
    return row
  }

  createMany(name: string, rows: Row[]): void {
    for (const r of rows) this.create(name, r)
  }

  /** Supports the exact `where` shapes the service uses: equality, and `{ in: [...] }`. */
  deleteMany(name: string, where: Row): number {
    const before = this.t(name).length
    const kept = this.t(name).filter((row) => !matches(row, where))
    this.tables.set(name, kept)
    return before - kept.length
  }

  findFirst(name: string, where: Row): Row | null {
    return this.t(name).find((row) => matches(row, where)) ?? null
  }
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in (v as Row)) {
      return ((v as { in: unknown[] }).in ?? []).includes(row[k])
    }
    return row[k] === v
  })
}

const store = new Store()

describe('import replay — the counting store itself', () => {
  /*
   * 🛑 THE DOUBLE IS THE INSTRUMENT, SO IT GETS ITS OWN CONTROL FIRST. Every
   * assertion below is a statement about this store's counts; if `deleteMany`
   * silently matched nothing, every convergence test would pass for the wrong
   * reason and this file would be exactly the "guard that cannot fail" it is
   * meant to prevent.
   */
  beforeEach(() => store.tables.clear())

  it('create appends and count reflects it', () => {
    store.create('t', { runId: 'r1' })
    store.create('t', { runId: 'r1' })
    expect(store.count('t')).toBe(2)
  })

  it('deleteMany removes only matching rows', () => {
    store.create('t', { runId: 'r1' })
    store.create('t', { runId: 'r2' })
    expect(store.deleteMany('t', { runId: 'r1' })).toBe(1)
    expect(store.count('t')).toBe(1)
    expect(store.findFirst('t', { runId: 'r2' })).not.toBeNull()
  })

  it('deleteMany honours an { in: [...] } filter', () => {
    store.create('t', { sourceReference: 'sleeper:1' })
    store.create('t', { sourceReference: 'sleeper:2' })
    store.create('t', { sourceReference: 'other:9' })
    expect(store.deleteMany('t', { sourceReference: { in: ['sleeper:1', 'sleeper:2'] } })).toBe(2)
    expect(store.count('t')).toBe(1)
  })

  it('deleteMany matches on ALL keys, not just the first', () => {
    store.create('t', { runId: 'r1', status: 'open' })
    store.create('t', { runId: 'r1', status: 'resolved' })
    expect(store.deleteMany('t', { runId: 'r1', status: 'open' })).toBe(1)
    expect(store.findFirst('t', { status: 'resolved' })).not.toBeNull()
  })
})

/**
 * The convergence contract, expressed directly over the store.
 *
 * These model the writer's shape — "clear this run's rows, then write this
 * attempt's rows" — rather than importing the service, because
 * `persistImportWithCanonicalAudit` reaches ~15 prisma delegates plus the
 * commit service, the legacy score engine and two dynamic imports. A double
 * broad enough to run it would be mostly untested scaffolding, and the failure
 * it is guarding against lives entirely in these few lines.
 *
 * ⚠ SO THIS IS A CONTRACT TEST, NOT AN END-TO-END ONE, AND SAYING SO MATTERS:
 * it proves the delete-then-create discipline converges, and it would NOT catch
 * someone deleting the `deleteMany` call from the service. The suites that
 * exercise the real entry point (`import-cross-account-league-join`,
 * `league-delete-tombstone`) cover that path's other behaviour; wiring a full
 * replay through it is the honest next step and is recorded as such rather than
 * quietly skipped.
 */
describe('import replay — a forced re-import must not accumulate rows', () => {
  beforeEach(() => store.tables.clear())

  /** One attempt of the reused-run write block, as the service now performs it. */
  function writeAttempt(runId: string, warnings: string[], reviewRequired: boolean) {
    store.deleteMany('importWarning', { runId })
    for (const code of warnings) store.create('importWarning', { runId, code })

    store.deleteMany('importReviewTask', { runId, taskType: 'import_review', status: 'open' })
    if (reviewRequired) {
      store.create('importReviewTask', { runId, taskType: 'import_review', status: 'open' })
    }
  }

  it('the same payload twice leaves the tables the same size', () => {
    writeAttempt('run-1', ['missing_rosters', 'partial_scoring'], true)
    const first = store.snapshot()

    writeAttempt('run-1', ['missing_rosters', 'partial_scoring'], true)
    const second = store.snapshot()

    expect(second).toEqual(first)
    expect(store.count('importWarning')).toBe(2)
    expect(store.count('importReviewTask')).toBe(1)
  })

  it('ten replays are the same size as one', () => {
    for (let i = 0; i < 10; i++) writeAttempt('run-1', ['missing_rosters'], false)
    expect(store.count('importWarning')).toBe(1)
  })

  it('positive control: WITHOUT the clear, the same payload doubles the rows', () => {
    /*
     * This is the defect as it actually stood, reproduced. If this test ever goes
     * green, the control has stopped reproducing the bug and the tests above are
     * no longer evidence of anything.
     */
    const writeAttemptUnfixed = (runId: string, warnings: string[]) => {
      for (const code of warnings) store.create('importWarning', { runId, code })
    }
    writeAttemptUnfixed('run-1', ['missing_rosters', 'partial_scoring'])
    expect(store.count('importWarning')).toBe(2)
    writeAttemptUnfixed('run-1', ['missing_rosters', 'partial_scoring'])
    expect(store.count('importWarning')).toBe(4) // the accumulation, before the fix
  })

  it('a DIFFERENT run is untouched — the clear is scoped to one run', () => {
    writeAttempt('run-1', ['a'], false)
    writeAttempt('run-2', ['b'], false)
    writeAttempt('run-1', ['a'], false)
    expect(store.count('importWarning')).toBe(2)
    expect(store.findFirst('importWarning', { runId: 'run-2' })).not.toBeNull()
  })

  it('a RESOLVED review task survives a replay — history is not erased', () => {
    store.create('importReviewTask', {
      runId: 'run-1',
      taskType: 'import_review',
      status: 'resolved',
    })
    writeAttempt('run-1', [], true)
    expect(store.findFirst('importReviewTask', { status: 'resolved' })).not.toBeNull()
    expect(store.count('importReviewTask')).toBe(2) // the resolved one, plus this attempt's open one
  })

  it('a task of another type survives a replay', () => {
    store.create('importReviewTask', { runId: 'run-1', taskType: 'commissioner_review', status: 'open' })
    writeAttempt('run-1', [], false)
    expect(store.findFirst('importReviewTask', { taskType: 'commissioner_review' })).not.toBeNull()
  })

  it('legacy evidence converges on sourceReference, and spares other leagues', () => {
    const write = (sourceRef: string, n: number) => {
      store.deleteMany('legacyEvidenceRecord', { sourceReference: { in: [sourceRef] } })
      store.createMany(
        'legacyEvidenceRecord',
        Array.from({ length: n }, (_, i) => ({ sourceReference: sourceRef, evidenceType: `e${i}` })),
      )
    }
    write('sleeper:111', 3)
    write('sleeper:222', 2)
    expect(store.count('legacyEvidenceRecord')).toBe(5)

    write('sleeper:111', 3) // the replay
    expect(store.count('legacyEvidenceRecord')).toBe(5)
    expect(store.count('legacyEvidenceRecord')).toBe(
      store.tables.get('legacyEvidenceRecord')!.length,
    )
    // the other league's rows are still all there
    expect(
      store.tables.get('legacyEvidenceRecord')!.filter((r) => r.sourceReference === 'sleeper:222'),
    ).toHaveLength(2)
  })
})

describe('import replay — the service still performs the clears', () => {
  /*
   * ⚠ THE ONE THING THE CONTRACT TESTS ABOVE CANNOT CATCH: someone deleting the
   * `deleteMany` calls from the service would leave every one of them green.
   * This reads the shipped source and asserts the clears are present, scoped as
   * intended — cheap, and it fails loudly if the discipline is removed.
   *
   * Comments are stripped first, because this file's own explanatory prose
   * mentions these very call shapes and would otherwise satisfy the assertion
   * about code that no longer exists.
   */
  const source = codeOnly(
    require('node:fs').readFileSync('lib/league-import/importPersistenceService.ts', 'utf8'),
  )

  function codeOnly(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n')
  }

  it('self-control: the comment stripper keeps code and drops prose', () => {
    expect(codeOnly('const a = 1 // note\n/* block */\nconst b = 2')).toContain('const a = 1')
    expect(codeOnly('const a = 1 // note\n/* block */\nconst b = 2')).toContain('const b = 2')
    expect(codeOnly('/* importWarning.deleteMany */')).not.toContain('deleteMany')
    // a URL's // must survive, or the stripper eats real code
    expect(codeOnly("const u = 'https://x.test/a'")).toContain('https://x.test/a')
  })

  it('clears importWarning by runId on BOTH write paths', () => {
    const hits = source.match(/importWarning\.deleteMany\(\{\s*where:\s*\{\s*runId:/g) ?? []
    expect(hits.length).toBe(2)
  })

  it('clears importReviewTask scoped to open import_review tasks, on both paths', () => {
    const hits = source.match(/importReviewTask\.deleteMany/g) ?? []
    expect(hits.length).toBe(2)
    expect(source).toContain("taskType: 'import_review'")
    expect(source).toContain("status: 'open'")
  })

  it('clears legacy evidence by sourceReference before writing it', () => {
    expect(source).toMatch(/legacyEvidenceRecord\.deleteMany/)
    const del = source.indexOf('legacyEvidenceRecord.deleteMany')
    const create = source.indexOf('legacyEvidenceRecord.createMany')
    expect(del).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(-1)
    expect(del).toBeLessThan(create) // delete must precede the write, or it clears what it just wrote
  })
})
