// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { leagueNcaafScorer } from '@/lib/league/collegePro/collegePoints'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'

/** Cream Bowl's imported scoring, as stored in production 2026-11-22 (`League.settings.scoringSettings`). */
const CREAM_BOWL = {
  scoringSettings: {
    source: 'fantrax',
    format: 'custom',
    rules: {
      rec: 1, kr_td: 6, pr_td: 6, rec_td: 6, rec_yd: 0.1, pass_td: 6, pass_yd: 0.04, rec_2pt: 2,
      rush_td: 6, rush_yd: 0.1, rush_2pt: 2, fum_rec_td: 6, bonus_rec_te: 0.5,
    },
  },
}

describe("the college football half scored with the college league's own Fantrax rules", () => {
  it("scores a quarterback with Cream Bowl's 6-point passing TDs and no interception penalty it never set", () => {
    const own = leagueNcaafScorer(CREAM_BOWL)!
    const line = { pass_yds: 250, pass_td: 2, pass_int: 1 }
    // 250 × 0.04 + 2 × 6, and the interception costs nothing.
    expect(own(line, 'QB')).toBeCloseTo(22, 5)
    // The defaults this replaces score the same line differently, which is the whole point.
    expect(buildLeagueStatScorer({ sport: 'NCAAF', settings: null })!(line, 'QB')).not.toBeCloseTo(22, 5)
  })

  it("gives a tight end Cream Bowl's 1.5 per catch (1 + the 0.5 premium), and a receiver 1", () => {
    const own = leagueNcaafScorer(CREAM_BOWL)!
    const line = { rec: 4, rec_yds: 40 }
    expect(own(line, 'TE')).toBeCloseTo(4 * 1.5 + 4, 5)
    expect(own(line, 'WR')).toBeCloseTo(4 + 4, 5)
  })

  it('falls back (null) for a league whose scoring was not imported from Fantrax', () => {
    expect(leagueNcaafScorer(null)).toBeNull()
    expect(leagueNcaafScorer({ scoringSettings: { source: 'manual', rules: { pass_td: 4 } } })).toBeNull()
  })

  it('falls back (null) rather than throwing when the imported rules cannot be read', () => {
    expect(leagueNcaafScorer({ scoringSettings: { source: 'fantrax', rules: { pass_td: 'six' } } })).toBeNull()
  })
})
