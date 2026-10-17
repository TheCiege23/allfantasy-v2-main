import { describe, expect, it } from 'vitest'
import { buildWeeklyCareer, type WeeklyScoreRow } from '@/lib/core-app/leagueWeeklyCareer'
import { leagueWeeklyCareerChimmyPrompts } from '@/lib/core-app/careerChimmy'
import type { LeagueWeeklyCareerData } from '@/lib/core-app/leagueCareer'

const ALL_FINAL = () => true
const MINE = new Set(['1'])

/** A week of scores, slot → points. */
function week(season: number, w: number, scores: Record<string, number>): WeeklyScoreRow[] {
  return Object.entries(scores).map(([slot, points]) => ({ slot, season, week: w, points }))
}

describe('buildWeeklyCareer', () => {
  it('is null when you never scored a final week', () => {
    expect(buildWeeklyCareer({ rows: week(2026, 1, { '2': 100, '3': 90 }), mySlots: MINE, format: 'scores', isFinal: ALL_FINAL })).toBeNull()
    expect(buildWeeklyCareer({ rows: week(2026, 1, { '1': 0, '2': 0 }), mySlots: MINE, format: 'scores', isFinal: ALL_FINAL })).toBeNull()
  })

  it('ranks each week against the teams that scored, and counts top and bottom scores', () => {
    const career = buildWeeklyCareer({
      rows: [
        ...week(2026, 1, { '1': 150, '2': 120, '3': 100 }), // 1st
        ...week(2026, 2, { '1': 80, '2': 120, '3': 100 }), // 3rd of 3
        ...week(2026, 3, { '1': 110, '2': 120, '3': 100 }), // 2nd
      ],
      mySlots: MINE,
      format: 'scores',
      isFinal: ALL_FINAL,
    })!
    expect(career.seasons).toEqual([
      {
        season: 2026,
        weeks: 3,
        pointsFor: 340,
        topScores: 1,
        bottomScores: 1,
        averageFinish: 2,
        bestFinish: 1,
        fieldSize: 3,
        choppedAfterWeek: null,
      },
    ])
    expect(career.totals).toEqual({ weeks: 3, pointsFor: 340, topScores: 1, averageFinish: 2 })
  })

  it('never ranks a zero — not yours, not a chopped team, not an unplayed week', () => {
    const career = buildWeeklyCareer({
      rows: [
        ...week(2026, 1, { '1': 100, '2': 120, '3': 0 }), // 3 is out: field of 2, you are 2nd
        ...week(2026, 2, { '1': 0, '2': 0, '3': 0 }), // unplayed: not a week
      ],
      mySlots: MINE,
      format: 'scores',
      isFinal: ALL_FINAL,
    })!
    expect(career.seasons[0]).toMatchObject({ weeks: 1, fieldSize: 2, averageFinish: 2, bottomScores: 1 })
  })

  it('in a guillotine, a zero after scoring is the chop — dated to the last week you played', () => {
    const rows = [
      ...week(2026, 1, { '1': 90, '2': 120, '3': 100, '4': 80 }), // 4 chopped after wk 1
      ...week(2026, 2, { '1': 85, '2': 120, '3': 100, '4': 0 }), // you are lowest: chopped after wk 2
      ...week(2026, 3, { '1': 0, '2': 130, '3': 110, '4': 0 }),
      ...week(2026, 4, { '1': 0, '2': 0, '3': 0, '4': 0 }), // unplayed
    ]
    const career = buildWeeklyCareer({ rows, mySlots: MINE, format: 'elimination', isFinal: ALL_FINAL })!
    expect(career.seasons[0]).toMatchObject({ weeks: 2, choppedAfterWeek: 2, bottomScores: 1, fieldSize: 4 })

    // Survivor: still scoring in the newest final week.
    const alive = buildWeeklyCareer({ rows, mySlots: new Set(['2']), format: 'elimination', isFinal: ALL_FINAL })!
    expect(alive.seasons[0]).toMatchObject({ weeks: 3, choppedAfterWeek: null, topScores: 3 })
  })

  it('makes no chop claim outside a guillotine — a missed week is just skipped', () => {
    const career = buildWeeklyCareer({
      rows: [...week(2026, 1, { '1': 90, '2': 120 }), ...week(2026, 2, { '1': 0, '2': 120 }), ...week(2026, 3, { '1': 130, '2': 120 })],
      mySlots: MINE,
      format: 'scores',
      isFinal: ALL_FINAL,
    })!
    expect(career.seasons[0]).toMatchObject({ weeks: 2, choppedAfterWeek: null, topScores: 1 })
  })

  it('drops weeks that are not final', () => {
    const career = buildWeeklyCareer({
      rows: [...week(2026, 1, { '1': 90, '2': 120 }), ...week(2026, 4, { '1': 150, '2': 20 })],
      mySlots: MINE,
      format: 'scores',
      isFinal: (_s, w) => w < 4,
    })!
    expect(career.seasons[0]).toMatchObject({ weeks: 1, topScores: 0, pointsFor: 90 })
  })

  it('orders seasons oldest first and weights the career average by weeks', () => {
    const career = buildWeeklyCareer({
      rows: [
        ...week(2026, 1, { '1': 100, '2': 50 }), // 1st
        ...week(2025, 1, { '1': 10, '2': 50 }), // 2nd
        ...week(2025, 2, { '1': 10, '2': 50 }), // 2nd
        ...week(2025, 3, { '1': 10, '2': 50 }), // 2nd
      ],
      mySlots: MINE,
      format: 'scores',
      isFinal: ALL_FINAL,
    })!
    expect(career.seasons.map((s) => s.season)).toEqual([2025, 2026])
    expect(career.firstSeason).toBe(2025)
    expect(career.lastSeason).toBe(2026)
    expect(career.totals.averageFinish).toBeCloseTo((2 * 3 + 1) / 4)
  })
})

describe('leagueWeeklyCareerChimmyPrompts', () => {
  const data = (over: Partial<LeagueWeeklyCareerData['weekly']['seasons'][number]> = {}, format: 'elimination' | 'scores' = 'elimination'): LeagueWeeklyCareerData => ({
    league: { id: 'L1', name: 'Chop Shop', platform: 'sleeper' },
    weekly: {
      format,
      seasons: [{ season: 2026, weeks: 3, pointsFor: 360, topScores: 1, bottomScores: 0, averageFinish: 4.3, bestFinish: 1, fieldSize: 16, choppedAfterWeek: null, ...over }],
      totals: { weeks: 3, pointsFor: 360, topScores: 1, averageFinish: 4.3 },
      firstSeason: 2026,
      lastSeason: 2026,
    },
    tradeGrade: { available: false, reason: 'none' },
    waiverGrade: { available: false, reason: 'none' },
    tradeStory: { available: false, reason: 'none' },
  })

  it('asks about survival while alive, and quotes only numbers the screen shows', () => {
    const [first, second] = leagueWeeklyCareerChimmyPrompts(data())
    expect(first.key).toBe('survive')
    expect(first.ask).toContain('survived 3 weeks')
    expect(first.ask).toContain('4.3 of 16')
    expect(second.ask).toContain('1 top score')
    expect(leagueWeeklyCareerChimmyPrompts(data()).some((p) => /\d+-\d+/.test(p.ask))).toBe(false)
  })

  it('does not ask how to survive once chopped, or in a league with no chop', () => {
    expect(leagueWeeklyCareerChimmyPrompts(data({ choppedAfterWeek: 2 }))[0].key).toBe('win-here')
    expect(leagueWeeklyCareerChimmyPrompts(data({}, 'scores'))[0].key).toBe('win-here')
  })
})
