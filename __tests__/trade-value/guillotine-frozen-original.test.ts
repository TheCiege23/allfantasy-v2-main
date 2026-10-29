/**
 * A guillotine league's frozen originals (`loadFrozenCompletedGrades`): Guap's ruling of 2026-10-11 —
 * trades frozen on the market chart show the guillotine grade. Such a row is skipped on read (never
 * edited or deleted), and the first guillotine original frozen after it wins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: null as null | { sport: string; leagueType: string | null; leagueVariant: string | null; settings: unknown; platform: string | null },
  rows: [] as Array<{ snapshotType: string; contextKey: string; payloadJson: unknown; createdAt: Date }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    tradeAnalysisSnapshot: {
      findMany: vi.fn(async ({ where }: { where: { snapshotType: string; contextKey: { in: string[] } } }) =>
        db.rows
          .filter((r) => r.snapshotType === where.snapshotType && where.contextKey.in.includes(r.contextKey))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
    },
  },
}))

import { loadFrozenCompletedGrades } from '@/lib/decision-os/trade/frozenCompletedGrade'

function original(source: string, letter: string, frozenAt: string) {
  return {
    v: 2, tradeId: 'T1', give: ['player:6770'], get: ['faab:75', 'player:8183'], frozenAt, basis: 'first_graded', pricedAsOf: frozenAt, tradeAt: '2026-10-11T03:00:00Z',
    grade: {
      graded: true, letter, partnerLetter: letter === 'F' ? 'A' : 'B', percentDiff: -20, label: 'x', sideAdvantage: 'opponent', action: 'decline',
      recommendation: 'x', giveValue: 40, getValue: 32, giveMarket: 40, getMarket: 32, unpriced: 0, basis: 'x', lines: [
        { side: 'give', name: 'Joe Burrow', marketValue: 40, leagueValue: 40, source: 'x', valueSource: source, valueAsOf: null },
        { side: 'get', name: '$75 FAAB', marketValue: 32, leagueValue: 32, source: 'x', valueSource: source === 'fantasycalc' ? 'faab_formula' : 'guillotine_faab', valueAsOf: null },
      ],
    },
  }
}
const row = (payloadJson: unknown, at: string) => db.rows.push({ snapshotType: 'completed_trade_grade_v2', contextKey: 'T1', payloadJson, createdAt: new Date(at) })
const GUILLOTINE = { sport: 'NFL', leagueType: 'guillotine', leagueVariant: null, settings: {}, platform: 'sleeper' }

beforeEach(() => {
  db.league = null
  db.rows = []
})

describe('frozen originals in a Guilly league', () => {
  it('skips the market-chart original and shows the guillotine one frozen after it', async () => {
    db.league = GUILLOTINE
    row(original('fantasycalc', 'F', '2026-10-11T04:00:00Z'), '2026-10-11T04:00:00Z')
    row(original('guillotine_points', 'D', '2026-10-12T04:00:00Z'), '2026-10-12T04:00:00Z')
    const frozen = (await loadFrozenCompletedGrades('L', ['T1'])).get('T1')
    expect(frozen?.grade.letter).toBe('D')
  })

  it('treats a Guilly league holding only market originals as having none, so the next read freezes anew', async () => {
    db.league = GUILLOTINE
    row(original('fantasycalc', 'F', '2026-10-11T04:00:00Z'), '2026-10-11T04:00:00Z')
    expect((await loadFrozenCompletedGrades('L', ['T1'])).has('T1')).toBe(false)
  })

  it('leaves every other league’s earliest original exactly as it was', async () => {
    db.league = { ...GUILLOTINE, leagueType: 'redraft' }
    row(original('fantasycalc', 'F', '2026-10-11T04:00:00Z'), '2026-10-11T04:00:00Z')
    row(original('guillotine_points', 'D', '2026-10-12T04:00:00Z'), '2026-10-12T04:00:00Z')
    expect((await loadFrozenCompletedGrades('L', ['T1'])).get('T1')?.grade.letter).toBe('F')
  })

  it('applies no filter when the league row cannot be read', async () => {
    db.league = null
    row(original('fantasycalc', 'F', '2026-10-11T04:00:00Z'), '2026-10-11T04:00:00Z')
    expect((await loadFrozenCompletedGrades('L', ['T1'])).get('T1')?.grade.letter).toBe('F')
  })
})
