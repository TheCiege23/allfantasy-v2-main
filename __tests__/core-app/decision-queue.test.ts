import { describe, expect, it } from 'vitest'
import { rankDecisions, splitDecisionQueue, TOP_DECISION_LIMIT } from '@/lib/core-app/decisionQueue'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

const NOW = Date.parse('2026-09-16T12:00:00Z')

function issue(id: string, severity: CoreIssue['severity'], deadlineHours: number | null): CoreIssue {
  return {
    id,
    severity,
    glyph: '•',
    title: id,
    meta: '',
    leagueId: null,
    leagueName: null,
    platform: null,
    deadline: deadlineHours == null ? null : new Date(NOW + deadlineHours * 3_600_000),
    action: null,
  }
}

const ids = (list: CoreIssue[]) => list.map((i) => i.id)

describe('rankDecisions', () => {
  it('ranks by severity before deadline — a distant timed draft no longer outranks stale data', () => {
    // The order deriveOutstandingIssues emits: every timed row above every untimed one.
    const arrived = [issue('draft-in-30d', 'info', 24 * 30), issue('stale', 'warn', null)]
    expect(ids(rankDecisions(arrived))).toEqual(['stale', 'draft-in-30d'])
  })

  it('puts an untimed bad row (already happening) above a timed bad row', () => {
    const arrived = [issue('draft-in-3h', 'bad', 3), issue('empty-slot', 'bad', null)]
    expect(ids(rankDecisions(arrived))).toEqual(['empty-slot', 'draft-in-3h'])
  })

  it('sinks an untimed warn/info row below the timed rows of the same severity', () => {
    const arrived = [issue('info-untimed', 'info', null), issue('info-in-2d', 'info', 48)]
    expect(ids(rankDecisions(arrived))).toEqual(['info-in-2d', 'info-untimed'])
  })

  it('orders by soonest deadline inside a severity', () => {
    const arrived = [issue('b-10h', 'bad', 10), issue('b-2h', 'bad', 2), issue('b-5h', 'bad', 5)]
    expect(ids(rankDecisions(arrived))).toEqual(['b-2h', 'b-5h', 'b-10h'])
  })

  it('keeps the arrival order for ties (stable)', () => {
    const arrived = [issue('empty-slot', 'bad', null), issue('starter-out', 'bad', null), issue('drafting', 'bad', null)]
    expect(ids(rankDecisions(arrived))).toEqual(['empty-slot', 'starter-out', 'drafting'])
  })

  it('accepts a deadline that crossed the wire as an ISO string, and treats garbage as untimed', () => {
    const iso = { ...issue('iso-1h', 'warn', null), deadline: new Date(NOW + 3_600_000).toISOString() as unknown as Date }
    const junk = { ...issue('junk', 'warn', null), deadline: 'not a date' as unknown as Date }
    const later = issue('warn-5h', 'warn', 5)
    expect(ids(rankDecisions([junk, later, iso]))).toEqual(['iso-1h', 'warn-5h', 'junk'])
  })

  it('is a permutation — nothing dropped, nothing added, input untouched', () => {
    const arrived = [issue('a', 'info', 1), issue('b', 'bad', null), issue('c', 'warn', 3), issue('d', 'bad', 2)]
    const before = ids(arrived)
    const ranked = rankDecisions(arrived)
    expect(ranked).toHaveLength(arrived.length)
    expect(new Set(ids(ranked))).toEqual(new Set(before))
    expect(ids(arrived)).toEqual(before)
    expect(ids(ranked)).toEqual(['b', 'd', 'c', 'a'])
  })
})

describe('splitDecisionQueue', () => {
  it('shows five and holds the rest back, in ranked order', () => {
    const arrived = Array.from({ length: 8 }, (_, n) => issue(`w${n}`, 'warn', 8 - n))
    const { top, rest, total } = splitDecisionQueue(arrived)
    expect(TOP_DECISION_LIMIT).toBe(5)
    expect(total).toBe(8)
    expect(ids(top)).toEqual(['w7', 'w6', 'w5', 'w4', 'w3'])
    expect(ids(rest)).toEqual(['w2', 'w1', 'w0'])
  })

  it('an empty queue is empty, not an error', () => {
    expect(splitDecisionQueue([])).toEqual({ top: [], rest: [], total: 0 })
  })
})
