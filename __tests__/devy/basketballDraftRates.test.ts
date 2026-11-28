// @vitest-environment node
/**
 * The basketball devy measurement (contracts/cbbd GAPS B-02, B-05): P(drafted | rank band, position) and the
 * drafted slot, from STORED rows only. Every input here is synthetic and lives in this file; the committed
 * generated table stays EMPTY, and that is asserted too.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  basketballDraftRateFor,
  BasketballMeasurementAbort,
  BASKETBALL_MIN_DRAFTED,
  BASKETBALL_MIN_RECRUITS,
  measureBasketballDraftRates,
  renderBasketballDraftRatesFile,
  type BasketballDraftRateCell,
} from '@/lib/devy/basketballDraftRates'
import { BASKETBALL_DRAFT_RATES, BASKETBALL_DRAFT_RATE_PROVENANCE } from '@/lib/devy/basketballDraftRates.generated'
import { parseStoredRecruitClass, type StoredBasketballRecruitClass } from '@/lib/devy/cbbdRecruitsStore'
import type { StoredCbbdDraftHistory, StoredCbbdHistoryPick } from '@/lib/devy/cbbdDraftHistoryIngest'

const pick = (athleteId: number | null, overall: number, college = true): StoredCbbdHistoryPick => ({
  athleteId, name: `P${athleteId}`, position: 'G', overall, round: overall > 30 ? 2 : 1, pick: ((overall - 1) % 30) + 1,
  overallRank: null, positionRank: null, college, sourceTeamCollegeId: college ? 1 : null, sourceTeamLocation: college ? 'U' : null,
  sourceTeamLeagueAffiliation: null, draftTeam: 'T',
})
const draft = (year: number, picks: StoredCbbdHistoryPick[]): StoredCbbdDraftHistory => ({
  year, fetchedAt: `${year}-08-01T00:00:00.000Z`, final: true, picks,
  counts: { picks: picks.length, college: picks.filter((p) => p.college).length, collegeWithAthleteId: picks.filter((p) => p.college && p.athleteId != null).length },
})
const recruitClass = (classYear: number, recruits: StoredBasketballRecruitClass['recruits']): StoredBasketballRecruitClass => ({ classYear, fetchedAt: 'x', source: 'synthetic', recruits })

/**
 * Class 2015: 60 guards ranked 1-10 (6 per rank, ids 1..60); ids 1-12 drafted in 2016 at picks 1-12, id 13 in 2020
 * at pick 40, id 14 in 2021 (OUTSIDE the C+1..C+5 window). One centre ranked 30 drafted in 2017 at pick 20.
 */
function fixture() {
  const recruits = [
    ...Array.from({ length: 60 }, (_, i) => ({ athleteId: i + 1, name: `G${i + 1}`, position: 'G' as const, nationalRank: Math.floor(i / 6) + 1 })),
    { athleteId: 500, name: 'C500', position: 'C' as const, nationalRank: 30 },
    { athleteId: 600, name: 'Unranked', position: 'F' as const, nationalRank: null },
  ]
  const drafts = new Map<number, StoredCbbdDraftHistory>([
    [2016, draft(2016, [...Array.from({ length: 12 }, (_, i) => pick(i + 1, i + 1)), pick(null, 13, false)])],
    [2017, draft(2017, [pick(500, 20), pick(999, 21)])],
    [2018, draft(2018, [pick(998, 5)])],
    [2019, draft(2019, [pick(997, 5)])],
    [2020, draft(2020, [pick(13, 40)])],
    [2021, draft(2021, [pick(14, 3)])],
  ])
  return { classes: new Map([[2015, recruitClass(2015, recruits)]]), drafts }
}

describe('measureBasketballDraftRates', () => {
  it('counts drafted recruits inside the five-draft window, by band and position, with the slots they went at', () => {
    const { cells, provenance } = measureBasketballDraftRates(fixture())
    const guards = cells.find((c) => c.position === 'G' && c.rankMin === 1)!
    expect(guards).toMatchObject({ rankMax: 11, recruits: 60, drafted: 13, rate: Number((13 / 60).toFixed(6)) })
    expect(guards.slots).toEqual([...Array.from({ length: 12 }, (_, i) => ({ overall: i + 1, count: 1 })), { overall: 40, count: 1 }])
    // Id 14 was drafted in 2021 = C+6: outside the window, so not drafted for this cohort.
    expect(guards.slots.some((s) => s.overall === 3 && s.count > 1)).toBe(false)
    expect(cells.find((c) => c.position === 'C')).toMatchObject({ rankMin: 26, recruits: 1, drafted: 1, slots: [{ overall: 20, count: 1 }] })
    // An unranked recruit is in no band.
    expect(cells.some((c) => c.position === 'F')).toBe(false)
    expect(provenance).toMatchObject({ measured: true, recruitClasses: [2015], draftYears: [2016, 2017, 2018, 2019, 2020], totalRecruits: 61, totalDrafted: 14 })
    // Join: college picks with an id in 2016-2020 = 12 + 2 + 1 + 1 + 1 = 17; of them 14 are stored recruits.
    expect(provenance.join).toEqual({ collegePicksInWindow: 17, matchedToRecruit: 14, matchRate: Number((14 / 17).toFixed(4)) })
  })

  it('aborts rather than measuring a class whose outcome window is not fully stored', () => {
    const f = fixture()
    f.drafts.delete(2019)
    expect(() => measureBasketballDraftRates(f)).toThrow(BasketballMeasurementAbort)
    expect(() => measureBasketballDraftRates(f)).toThrow(/2019 draft, which is not stored/)
    expect(() => measureBasketballDraftRates({ classes: new Map(), drafts: f.drafts })).toThrow(/no stored recruiting classes/)
  })

  it('renders a table the lookup reads back', () => {
    const measured = measureBasketballDraftRates(fixture())
    const text = renderBasketballDraftRatesFile(measured)
    expect(text).toContain('"measured": true')
    expect(text).toContain('"rankMin": 1')
  })
})

describe('the minimum-n rule', () => {
  const cell = (recruits: number, drafted: number): BasketballDraftRateCell => ({ position: 'G', rankMin: 1, rankMax: 11, recruits, drafted, rate: drafted / recruits, slots: [{ overall: 1, count: drafted }] })

  it('prices a cell only at the floor on BOTH counts', () => {
    expect(basketballDraftRateFor('G', 5, [cell(BASKETBALL_MIN_RECRUITS, BASKETBALL_MIN_DRAFTED)])).not.toBeNull()
    expect(basketballDraftRateFor('G', 5, [cell(BASKETBALL_MIN_RECRUITS - 1, BASKETBALL_MIN_DRAFTED)])).toBeNull()
    expect(basketballDraftRateFor('G', 5, [cell(BASKETBALL_MIN_RECRUITS, BASKETBALL_MIN_DRAFTED - 1)])).toBeNull()
  })

  it('needs a matching band and position, and a rank', () => {
    const ok = [cell(80, 20)]
    expect(basketballDraftRateFor('g', 10, ok)).not.toBeNull()
    expect(basketballDraftRateFor('G', 11, ok)).toBeNull()
    expect(basketballDraftRateFor('F', 5, ok)).toBeNull()
    expect(basketballDraftRateFor('G', null, ok)).toBeNull()
  })
})

describe('the committed table', () => {
  it('is EMPTY and says it is not measured — no invented rate ships', () => {
    expect(BASKETBALL_DRAFT_RATES).toEqual([])
    expect(BASKETBALL_DRAFT_RATE_PROVENANCE).toMatchObject({ measured: false, totalRecruits: 0, join: null })
    expect(BASKETBALL_DRAFT_RATE_PROVENANCE.status).toMatch(/^NOT MEASURED/)
    // The committed file is exactly the renderer's empty state, so it was generated, not hand-filled.
    const committed = readFileSync(join(process.cwd(), 'lib/devy/basketballDraftRates.generated.ts'), 'utf8')
    expect(committed).toBe(renderBasketballDraftRatesFile(null))
    // With the default (committed) table, nobody prices.
    expect(basketballDraftRateFor('G', 1)).toBeNull()
  })
})

describe('stored recruiting rows', () => {
  it('keeps only rows in the stored shape and never coerces one', () => {
    const parsed = parseStoredRecruitClass({
      classYear: 2019, fetchedAt: 'x', source: 's',
      recruits: [
        { athleteId: 1, name: 'A', position: 'G', nationalRank: 3 },
        { athleteId: 2, name: 'B', position: 'Guard', nationalRank: 3 },
        { athleteId: '3', name: 'C', position: 'F', nationalRank: 3 },
        { athleteId: null, name: 'D', position: null, nationalRank: null },
        { athleteId: 5, name: 'E', position: 'C', nationalRank: 0 },
      ],
    })
    expect(parsed?.recruits.map((r) => r.name)).toEqual(['A', 'D'])
    expect(parseStoredRecruitClass({ classYear: 2019 })).toBeNull()
  })
})
