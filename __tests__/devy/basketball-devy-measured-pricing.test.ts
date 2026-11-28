/**
 * The measured NBA devy path (owner, 2026-11-28): an earlier-class college prospect with no usable pre-draft rank
 * prices as P(drafted | rank band, position) × E[this league's pickDynastyValue at the drafted slot] × discount —
 * but ONLY when his cohort cell reaches its minimum n. The ranked path is unchanged, the committed (empty) table
 * withholds everyone, and football's devy option is untouched.
 *
 * The synthetic table is injected HERE only: `table:` on the pure function, and a `vi.mock` of the generated
 * module for the grade, toggled per test. lib/devy/basketballDraftRates.generated.ts stays empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BasketballDraftRateCell } from '@/lib/devy/basketballDraftRates'

const injected = vi.hoisted(() => ({ rates: [] as BasketballDraftRateCell[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/devy/basketballDraftRates.generated', () => ({
  get BASKETBALL_DRAFT_RATES() {
    return injected.rates
  },
  BASKETBALL_DRAFT_RATE_PROVENANCE: { measured: false },
}))

import {
  FUTURE_DISCOUNT,
  nbaMeasuredProspectValue,
  nbaProspectValue,
  pickDynastyValue,
  priceSportDynastySides,
  youngPlayerPool,
  type DynastyGradedSport,
  type NbaRecruitingProspect,
  type SportDynastyContext,
} from '@/lib/decision-os/trade/sportDynastyValue'
import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import type { NbaProspectRank } from '@/lib/adp/nbaProspectRanks'
import { devyOptionValue } from '@/lib/devy/devyOptionValue'

const p = (id: string, perGame: number): BoardPlayer => ({ id, name: id, position: 'PG', perGame, sampleGames: 60, aliases: [] })
const board = [p('y1', 50), p('y2', 44), p('y3', 40), p('y4', 36), p('y5', 32), p('y6', 28), p('wire', 18)]
const ages = new Map([['y1', 20], ['y2', 21], ['y3', 20], ['y4', 22], ['y5', 21], ['y6', 20], ['wire', 27]])
type Ctx = SportPointsContext & { sport: DynastyGradedSport }
const ctx: Ctx = {
  sport: 'NBA', board, replacementByPosition: new Map([['PG', { name: 'wire', perGame: 18 }]]),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 79 }, scoringBasis: 'league', teams: 3,
}
const PROSPECT_ID = 'espn:ncaab:4433'
const prospect: NbaRecruitingProspect = { name: 'Freshman Guard', position: 'G', nationalRank: 4, draftYear: 2029 }
const dynasty = (over: Partial<SportDynastyContext> = {}): SportDynastyContext => ({
  ages, nextDraftYear: 2027, nbaProspectRecruiting: new Map([[PROSPECT_ID, prospect]]), ...over,
})

/** 80 guards ranked 1-10, 20 drafted: 10 at pick 1, 10 at pick 4. */
const MEASURED: BasketballDraftRateCell = {
  position: 'G', rankMin: 1, rankMax: 11, recruits: 80, drafted: 20, rate: 0.25,
  slots: [{ overall: 1, count: 10 }, { overall: 4, count: 10 }],
}
const pool = youngPlayerPool(ctx, dynasty())
const at = (overall: number, year: number) => {
  const v = pickDynastyValue({ sport: 'NBA', pool, teams: 3, nextDraftYear: 2027, pick: { kind: 'pick', year, round: Math.ceil(overall / 3), overall } })
  if (!v.ok) throw new Error(v.reason)
  return v.value
}
const deal = (d: SportDynastyContext) =>
  priceSportDynastySides({ ctx, dynasty: d, give: [{ kind: 'player', rosterPlayerId: PROSPECT_ID, name: 'Freshman Guard' }], get: [{ kind: 'player', playerId: 'y6' }] })

beforeEach(() => {
  injected.rates = []
})

describe('nbaMeasuredProspectValue', () => {
  it('is P × E[the league’s own pick value at the drafted slots] × the discount to his draft year', () => {
    const out = nbaMeasuredProspectValue(prospect, { pool, teams: 3, season: 2026, nextDraftYear: 2027, table: [MEASURED] })
    const expectedIfDrafted = (10 * at(1, 2029) + 10 * at(4, 2029)) / 20
    expect(out).not.toBeNull()
    expect(out!.expectedIfDrafted).toBeCloseTo(expectedIfDrafted, 9)
    expect(out!.value).toBeCloseTo(0.25 * expectedIfDrafted * FUTURE_DISCOUNT ** 3, 9)
    expect(out).toMatchObject({ pDrafted: 0.25, recruits: 80, drafted: 20 })
  })

  it('withholds (null, never 0) below the minimum n, outside every band, or with no usable draft year', () => {
    const thin = { ...MEASURED, recruits: 49 }
    const few = { ...MEASURED, drafted: 9, slots: [{ overall: 1, count: 9 }] }
    const args = { pool, teams: 3, season: 2026, nextDraftYear: 2027 }
    expect(nbaMeasuredProspectValue(prospect, { ...args, table: [thin] })).toBeNull()
    expect(nbaMeasuredProspectValue(prospect, { ...args, table: [few] })).toBeNull()
    expect(nbaMeasuredProspectValue({ ...prospect, nationalRank: 40 }, { ...args, table: [MEASURED] })).toBeNull()
    expect(nbaMeasuredProspectValue({ ...prospect, position: 'C' }, { ...args, table: [MEASURED] })).toBeNull()
    expect(nbaMeasuredProspectValue({ ...prospect, draftYear: null }, { ...args, table: [MEASURED] })).toBeNull()
    expect(nbaMeasuredProspectValue({ ...prospect, draftYear: 2026 }, { ...args, table: [MEASURED] })).toBeNull()
  })

  it('withholds everyone against the committed (empty) table', () => {
    expect(nbaMeasuredProspectValue(prospect, { pool, teams: 3, season: 2026, nextDraftYear: 2027 })).toBeNull()
  })
})

describe('the NBA dynasty grade', () => {
  it('prices an unranked earlier-class prospect from a measured cohort, in league units', () => {
    injected.rates = [MEASURED]
    const out = deal(dynasty())
    expect(out, JSON.stringify(out)).toMatchObject({ graded: true })
    if (!out.graded) return
    const line = out.lines.find((l) => l.name === 'Freshman Guard')!
    const expected = nbaMeasuredProspectValue(prospect, { pool, teams: 3, season: 2026, nextDraftYear: 2027, table: [MEASURED] })!.value
    expect(expected).toBeGreaterThan(0)
    expect(line).toMatchObject({ source: 'nba-points-dynasty', valueSource: 'pick_curve' })
    expect(line.marketValue).toBeCloseTo(Math.round(expected * 10) / 10, 6)
    expect(out.basis).toContain('recruiting cohort')
  })

  it('withholds the same deal when the cell is under its minimum n, or the table is empty', () => {
    injected.rates = [{ ...MEASURED, recruits: 49 }]
    expect(deal(dynasty())).toMatchObject({ graded: false, reason: expect.stringContaining('verified NBA prospect rank') })
    injected.rates = []
    expect(deal(dynasty())).toMatchObject({ graded: false })
  })

  it('keeps the rank → slot pricing for a prospect ranked for the next draft, even with a measured cohort', () => {
    injected.rates = [MEASURED]
    const rank: NbaProspectRank = { playerId: PROSPECT_ID, name: 'Freshman Guard', rank: 2, draftYear: 2027, publishedAt: '2026-10-10T00:00:00Z' } as NbaProspectRank
    const out = deal(dynasty({ nbaProspectRanks: new Map([[PROSPECT_ID, rank]]) }))
    expect(out.graded).toBe(true)
    if (!out.graded) return
    const line = out.lines.find((l) => l.name === 'Freshman Guard')!
    const ranked = nbaProspectValue(rank, { pool, teams: 3, season: 2026, nextDraftYear: 2027 })!
    expect(line.marketValue).toBeCloseTo(Math.round(ranked * 10) / 10, 6)
    expect(line.valueAsOf).toBe('2026-10-10T00:00:00Z')
    expect(out.basis).not.toContain('recruiting cohort')
  })
})

describe('football is unchanged (control)', () => {
  it('prices the same NCAAF prospect at the same value as before this change', () => {
    injected.rates = [MEASURED]
    const wr = { sport: 'NCAAF', position: 'WR', ppaSeasonTotal: 45, recruitingComposite: 0.98, recruitingStars: 5, draftEligibleYear: 2027, currentSeason: 2026 }
    // 67 measured on the base (keep/devy-nba c23a0d73a6 on origin/main d243962c39) before this change.
    expect(devyOptionValue(wr)).toMatchObject({ value: 67, pSource: 'production', pSampleSize: 372, arrivalValue: 1006 })
    expect(devyOptionValue({ ...wr, sport: 'NCAAB' }).value).toBeNull()
  })
})
