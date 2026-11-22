/**
 * The Decision OS ledger for auto-picks (2026-11-22): the pick the clock made is recorded with why and
 * the board's projections, graded per strategy, kept out of the draft card's confidence, and its record
 * shown back on "Draft like me".
 */
import { describe, expect, it, vi } from 'vitest'
import { AUTOPICK_SURFACE, buildAutopickRecord } from '@/lib/shared-services/draft/recommendationRecorder'
import { draftAsMeRecordLine } from '@/lib/draft-room/draftAsMeAutopick'

vi.mock('server-only', () => ({}))

const projections = { 'Pick Me|RB': 210, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Alt Guy${i}|WR`, 200 - i])) }

describe('buildAutopickRecord', () => {
  const base = {
    sport: 'nfl',
    leagueId: 'L1',
    sessionKey: 'S1',
    rosterKey: 'R1',
    overallPick: 8,
    round: 2,
    picked: { name: 'Pick Me', position: 'RB', team: 'MIA', adp: 11.5 },
    strategy: 'draft-as-me',
    reason: 'Picked the way you draft.',
    projections: new Map(Object.entries(projections)),
    poolSize: 300,
  }

  it('stores the player actually picked, why, and the board it was picked from', () => {
    const row = buildAutopickRecord(base)!
    expect(row).toMatchObject({
      surface: AUTOPICK_SURFACE,
      sport: 'NFL',
      dedupeKey: 'autopick:S1:R1:8',
      servedMode: 'active',
      activeName: 'Pick Me',
      activePosition: 'RB',
      observeName: 'Pick Me',
      agree: true,
      projectionCount: 13,
      engineVersion: 'autopick/2026-11-22',
    })
    expect(row.detail).toMatchObject({ autopick: { strategy: 'draft-as-me', reason: 'Picked the way you draft.' }, active: { name: 'Pick Me', projectedPoints: 210 } })
  })

  it('writes nothing when the board has too few projections to ever grade it', () => {
    expect(buildAutopickRecord({ ...base, projections: new Map([['Pick Me|RB', 210]]) })).toBeNull()
    expect(buildAutopickRecord({ ...base, picked: { ...base.picked, name: ' ' } })).toBeNull()
  })
})

describe('draftAsMeRecordLine', () => {
  it('says nothing until 20 picks are graded, then the share that beat the board', () => {
    expect(draftAsMeRecordLine({ early: { held: 10, missed: 5 } })).toBeNull()
    expect(draftAsMeRecordLine({ early: { held: 12, missed: 3 }, middle: { held: 3, missed: 2 } })).toBe(
      'This season Draft like me picks have outscored the players left on the board 75% of the time (20 graded).',
    )
    expect(draftAsMeRecordLine(null)).toBeNull()
  })
})

describe('the six-hourly rebuild', () => {
  it('grades auto-picks per strategy and never mixes them into the draft card tips', async () => {
    const { recomputeLedgerRecord } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const week = (w: number) => new Date(Date.UTC(2026, 8, 10 + 7 * (w - 1), 17))
    const players = [
      { id: 'sp-pick', externalId: null, sleeperId: 's-pick', source: 'x', name: 'Pick Me', position: 'RB' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `sp-${i}`, externalId: null, sleeperId: `s-${i}`, source: 'x', name: `Alt Guy${i}`, position: 'WR' })),
    ]
    const stats = [2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((wk) => [
      { playerId: 's-pick', weekOrRound: wk, fantasyPoints: 20, normalizedStatMap: {} },
      ...Array.from({ length: 12 }, (_, i) => ({ playerId: `s-${i}`, weekOrRound: wk, fantasyPoints: 10, normalizedStatMap: {} })),
    ])
    const at = new Date(Date.UTC(2026, 8, 12))
    const advice = { surface: 'decision_card', createdAt: at, round: 2, servedMode: 'observe', observeName: 'Pick Me', observePosition: 'RB', activeName: 'Pick Me', activePosition: 'RB', detail: { projections } }
    const auto = (strategy: string) => ({ ...advice, surface: 'autopick', servedMode: 'active', detail: { projections, autopick: { strategy, reason: 'x' } } })
    const rows = [
      ...Array.from({ length: 22 }, () => advice),
      ...Array.from({ length: 5 }, () => auto('draft-as-me')),
      ...Array.from({ length: 3 }, () => auto('bpa')),
    ]
    const findMany = vi.fn(async (args: { where: { surface?: string | { not: string } } }) => {
      const s = args.where.surface
      return rows.filter((r) => (s == null ? true : typeof s === 'string' ? r.surface === s : r.surface !== s.not))
    })
    const db = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?')
        if (sql.includes('FROM "SportsGame"')) return Array.from({ length: 10 }, (_, i) => ({ week: i + 1, first: week(i + 1), last: week(i + 1) }))
        return []
      }),
      sportsPlayer: { findMany: vi.fn(async () => players) },
      playerGameStat: { findMany: vi.fn(async () => stats) },
      draftRecommendationRecord: { findMany },
    }
    const snap = await recomputeLedgerRecord({ now: new Date('2026-11-21T12:00:00Z'), db: db as never })
    expect(snap?.draftTips).toEqual({ early: { held: 22, missed: 0 } })
    expect(snap?.autopicks).toEqual({ 'draft-as-me': { early: { held: 5, missed: 0 } }, bpa: { early: { held: 3, missed: 0 } } })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ surface: { not: 'autopick' } }) }))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ surface: 'autopick' }) }))
  })
})
