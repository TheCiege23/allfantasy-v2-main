import { describe, it, expect } from 'vitest'
import { gradePicks, letterFor, median, type GradablePick } from '@/lib/draft-intel/gradeDraftPicks'
import { resolveImportedScoring } from '@/lib/draft-intel/importedDraftReport'

const pick = (over: Partial<GradablePick> & { round: number; pickNo: number }): GradablePick => ({
  playerId: `p${over.pickNo}`,
  playerName: 'Player',
  position: 'RB',
  byOwnerId: 'owner-a',
  byName: 'Manager A',
  teamName: 'Team A',
  avatar: null,
  initialPoints: null,
  currentPoints: null,
  ...over,
})

describe('letterFor', () => {
  it('holds the published thresholds, which the payload tells readers to recompute from', () => {
    expect(letterFor(25)).toBe('A')
    expect(letterFor(24.9)).toBe('B')
    expect(letterFor(10)).toBe('B')
    expect(letterFor(9.9)).toBe('C')
    expect(letterFor(-10)).toBe('D')
    expect(letterFor(-25)).toBe('F')
  })
})

describe('median', () => {
  it('averages the middle pair on an even count', () => {
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(median([10, 20, 30])).toBe(20)
    expect(median([])).toBeNull()
  })
})

describe('gradePicks', () => {
  it('scores each pick against its OWN round, not against the draft', () => {
    /* Round 1 returns far more than round 2. A round-2 pick beating its round must
       not be punished for trailing round 1. */
    const graded = gradePicks([
      pick({ round: 1, pickNo: 1, initialPoints: 300, currentPoints: 300 }),
      pick({ round: 1, pickNo: 2, initialPoints: 100, currentPoints: 100, byOwnerId: 'b', byName: 'B' }),
      pick({ round: 2, pickNo: 3, initialPoints: 90, currentPoints: 90 }),
      pick({ round: 2, pickNo: 4, initialPoints: 10, currentPoints: 10, byOwnerId: 'b', byName: 'B' }),
    ])
    const r2Winner = graded.gradedPicks.find((g) => g.pickNo === 3)
    // Round-2 median is 50, so a 90 is +40 even though round 1 produced 300.
    expect(r2Winner?.initialValueOver).toBe(40)
  })

  it('uses the median so one outlier does not condemn a whole round', () => {
    const graded = gradePicks([
      pick({ round: 1, pickNo: 1, initialPoints: 1000, currentPoints: 1000 }),
      pick({ round: 1, pickNo: 2, initialPoints: 100, currentPoints: 100, byOwnerId: 'b', byName: 'B' }),
      pick({ round: 1, pickNo: 3, initialPoints: 100, currentPoints: 100, byOwnerId: 'c', byName: 'C' }),
    ])
    // Mean would be 400 and mark both 100s as -300 failures. Median is 100.
    expect(graded.gradedPicks.find((g) => g.pickNo === 2)?.initialValueOver).toBe(0)
  })

  it('does not count an unscoreable pick against the manager who made it', () => {
    /* A pick with no points is missing DATA, not a bad pick. Averaging it in as a
       zero would punish managers for gaps in our own coverage. */
    const graded = gradePicks([
      pick({ round: 1, pickNo: 1, initialPoints: 200, currentPoints: 200 }),
      pick({ round: 1, pickNo: 2, initialPoints: null, currentPoints: null }),
      pick({ round: 1, pickNo: 3, initialPoints: 100, currentPoints: 100, byOwnerId: 'b', byName: 'B' }),
    ])
    const a = graded.managers.find((m) => m.ownerId === 'owner-a')
    expect(a?.picks).toBe(2) // both picks are listed
    // ...but only the scoreable one contributes: median 150, so +50 over one pick.
    expect(a?.initialScore).toBe(50)
    expect(a?.initialGrade).toBe('A')
  })

  it('returns an empty grading rather than throwing on no picks', () => {
    expect(gradePicks([])).toEqual({
      rounds: 0,
      gradedPicks: [],
      managers: [],
      steals: [],
      busts: [],
    })
  })

  it('reports steady when nothing moved, so redraft shows no phantom trend', () => {
    const graded = gradePicks([
      pick({ round: 1, pickNo: 1, initialPoints: 200, currentPoints: 200 }),
      pick({ round: 1, pickNo: 2, initialPoints: 100, currentPoints: 100, byOwnerId: 'b', byName: 'B' }),
    ])
    expect(graded.managers.every((m) => m.trend === 'steady')).toBe(true)
  })
})

describe('resolveImportedScoring', () => {
  it('now scores an ESPN league on its own rules, because the ids are derived', () => {
    /* Before the stat dictionary this was the fragment case: only espn_stat_53
       resolved, so the whole map was dropped. These ids are now evidence-derived
       from 1,277 player-seasons, so the league's real weights are used. */
    const r = resolveImportedScoring(
      {
        espn_stat_3: 0.04,
        espn_stat_4: 4,
        espn_stat_24: 0.1,
        espn_stat_25: 6,
        espn_stat_42: 0.1,
        espn_stat_43: 6,
        espn_stat_53: 1,
      },
      'espn',
    )
    expect(r.basis).toBe('league-scored')
    expect(r.settings.pass_yd).toBe(0.04)
    expect(r.settings.rush_td).toBe(6)
    expect(r.settings.rec).toBe(1)
  })

  it('still refuses a fragment when the rules that resolve are not core ones', () => {
    /* Defensive and team-defense ids did NOT clear the evidence bar and are absent
       on purpose. A league whose only translatable rule is receptions must still
       fall back rather than rank every player by catches. */
    const r = resolveImportedScoring(
      { espn_stat_53: 1, espn_stat_101: 6, espn_stat_102: 6, espn_stat_201: 6 },
      'espn',
    )
    expect(r.basis).toBe('format-approx')
    expect(r.settings).toEqual({})
  })

  it('says so when scoring on league rules with some rules untranslatable', () => {
    /* "league-scored" with a tenth of the rules missing is a claim needing its own
       footnote — those weights become silent zeros for whoever accrues them. */
    const r = resolveImportedScoring(
      {
        espn_stat_3: 0.04,
        espn_stat_4: 4,
        espn_stat_24: 0.1,
        espn_stat_25: 6,
        espn_stat_42: 0.1,
        espn_stat_43: 6,
        espn_stat_53: 1,
        espn_stat_101: 6,
        espn_stat_201: 6,
      },
      'espn',
    )
    expect(r.basis).toBe('league-scored')
    expect(r.note).toMatch(/2 of its scoring rules could not be translated/)
    expect(r.note).toMatch(/kickers and team defenses are understated/)
  })

  it('does not count a zero-weight rule as an untranslatable gap', () => {
    /* A league declaring a rule at 0 loses nothing by our not translating it. */
    const r = resolveImportedScoring(
      {
        espn_stat_3: 0.04,
        espn_stat_4: 4,
        espn_stat_24: 0.1,
        espn_stat_25: 6,
        espn_stat_42: 0.1,
        espn_stat_43: 6,
        espn_stat_53: 1,
        espn_stat_101: 0,
        espn_stat_201: 0,
      },
      'espn',
    )
    expect(r.note).toBeNull()
  })

  it('scores on the league rules when a real set of keys resolves', () => {
    const r = resolveImportedScoring(
      { rec: 1, rec_yd: 0.1, rec_td: 6, pass_yd: 0.04, pass_td: 6, rush_yd: 0.1, rush_td: 6 },
      'fantrax',
    )
    expect(r.basis).toBe('league-scored')
    expect(r.note).toBeNull()
    expect(r.settings.pass_yd).toBe(0.04)
  })

  it('takes the format from the reception weight, not from scoringPresetId', () => {
    /* Both production ESPN leagues carry preset `fb_half_ppr` while their reception
       rule is 1.0. The rule is the fact; the preset is a stale label. */
    expect(resolveImportedScoring({ espn_stat_53: 1 }, 'espn').format).toBe('ppr')
    expect(resolveImportedScoring({ espn_stat_53: 0.5 }, 'espn').format).toBe('half_ppr')
    expect(resolveImportedScoring({ espn_stat_53: 0 }, 'espn').format).toBe('std')
  })

  it('survives empty or absent rules', () => {
    expect(resolveImportedScoring(null, 'espn').basis).toBe('format-approx')
    expect(resolveImportedScoring({}, 'espn').format).toBe('std')
  })
})
