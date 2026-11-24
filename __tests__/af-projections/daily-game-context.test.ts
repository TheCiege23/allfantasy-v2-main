import { describe, expect, it } from 'vitest'

import { coachSeasonOf, coachingLevelOn } from '@/lib/af-projections/factors/coachRegistry'
import { COACH_STINTS, type CoachStintEntry } from '@/lib/af-projections/factors/coachStints'
import { dailyGameContext, loadMlbWeatherLevels } from '@/lib/af-projections/factors/dailyGameContext'
import { readGameLines } from '@/lib/af-projections/factors/factorLearning'

/**
 * NBA / NHL / MLB coaching and MLB weather as factor levels (owner, 2026-11-23). The coaching level must follow the
 * day a coach took over — a mid-season firing splits a season — and a day the list cannot settle gets no level.
 */

const at = (iso: string) => Date.parse(`${iso}T23:00:00Z`)

describe('coachSeasonOf', () => {
  it('turns NBA/NHL seasons over on July 1 and MLB seasons on November 15', () => {
    expect(coachSeasonOf('NBA', at('2026-06-30'))).toBe(2026)
    expect(coachSeasonOf('NBA', at('2026-07-01'))).toBe(2027)
    expect(coachSeasonOf('NHL', at('2027-04-10'))).toBe(2027)
    expect(coachSeasonOf('MLB', at('2026-11-14'))).toBe(2026)
    expect(coachSeasonOf('MLB', at('2026-11-15'))).toBe(2027)
  })
})

describe('coachingLevelOn', () => {
  const stints: CoachStintEntry[] = [
    { team: 'BOS', coach: 'Old Coach', from: '2021-06-28', to: '2025-12-10' },
    { team: 'BOS', coach: 'Interim Guy', from: '2025-12-10', to: '2026-05-01', interim: true },
    { team: 'BOS', coach: 'Interim Guy', from: '2026-05-01', to: null },
    { team: 'LAL', coach: 'Summer Hire', from: '2025-06-05', to: null },
    { team: 'MIA', coach: 'A', from: '2024-07-01', to: null },
    { team: 'MIA', coach: 'B', from: '2025-01-01', to: null },
  ]

  it('an offseason hire is new for the season he was hired for, then the same coach', () => {
    expect(coachingLevelOn('NBA', 'LAL', at('2025-11-02'), stints)).toBe('new_coach')
    expect(coachingLevelOn('NBA', 'Los Angeles Lakers', at('2026-03-02'), stints)).toBe('new_coach')
    expect(coachingLevelOn('NBA', 'LAL', at('2026-11-02'), stints)).toBe('same_coach')
  })

  it('a mid-season firing splits the season on the day it happened', () => {
    expect(coachingLevelOn('NBA', 'BOS', at('2025-12-09'), stints)).toBe('same_coach')
    expect(coachingLevelOn('NBA', 'BOS', at('2025-12-10'), stints)).toBe('new_coach')
  })

  it('an interim coach given the job keeps the season he started in: one tenure, not two', () => {
    expect(coachingLevelOn('NBA', 'BOS', at('2026-05-10'), stints)).toBe('new_coach')
    expect(coachingLevelOn('NBA', 'BOS', at('2026-11-10'), stints)).toBe('same_coach')
  })

  it('no level for a day no stint covers, two stints both claim, an unknown team or another sport', () => {
    expect(coachingLevelOn('NBA', 'LAL', at('2025-05-01'), stints)).toBeUndefined()
    expect(coachingLevelOn('NBA', 'MIA', at('2025-03-01'), stints)).toBeUndefined()
    expect(coachingLevelOn('NBA', 'ZZZ', at('2025-11-02'), stints)).toBeUndefined()
    expect(coachingLevelOn('NFL', 'BOS', at('2025-11-02'), stints)).toBeUndefined()
  })

  it('a takeover in the last month of a regular season makes the next season new too', () => {
    // Denver, 2025-04-08: interim with three games left, given the job on 2025-05-22.
    expect(coachingLevelOn('NBA', 'DEN', at('2025-04-10'))).toBe('new_coach')
    expect(coachingLevelOn('NBA', 'DEN', at('2025-12-01'))).toBe('new_coach')
    expect(coachingLevelOn('NBA', 'DEN', at('2026-12-01'))).toBe('same_coach')
    // A mid-season firing earlier than that is one season only (Sacramento, 2024-12-27).
    expect(coachingLevelOn('NBA', 'SAC', at('2025-03-01'))).toBe('new_coach')
    expect(coachingLevelOn('NBA', 'SAC', at('2025-12-01'))).toBe('same_coach')
  })

  it("MLB's two Washington spellings are one team", () => {
    const mlb: CoachStintEntry[] = [{ team: 'WSH', coach: 'Skipper', from: '2025-11-20', to: null }]
    expect(coachingLevelOn('MLB', 'WSN', at('2026-05-01'), mlb)).toBe('new_coach')
    expect(coachingLevelOn('MLB', 'WAS', at('2027-05-01'), mlb)).toBe('same_coach')
  })
})

describe('the committed coach list', () => {
  // A team between managers (the Angels since 2026-10-21) has no one in charge — and so no level, never a guess.
  const VACANT: Record<string, string[]> = { MLB: ['LAA'] }
  it.each(['NBA', 'NHL', 'MLB'] as const)('%s: every team has one coach in charge today (or a known vacancy), and no stint overlaps another', (sport) => {
    const list = COACH_STINTS[sport]
    const teams = new Set(list.map((s) => s.team))
    expect(teams.size).toBe(sport === 'NHL' ? 32 : 30)
    for (const team of teams) {
      const mine = list.filter((s) => s.team === team).sort((a, b) => a.from.localeCompare(b.from))
      const vacant = (VACANT[sport] ?? []).includes(team)
      expect(mine.filter((s) => s.to == null), `${sport} ${team} current`).toHaveLength(vacant ? 0 : 1)
      for (let i = 1; i < mine.length; i++) expect(mine[i - 1]!.to! <= mine[i]!.from, `${sport} ${team} ${mine[i]!.coach}`).toBe(true)
      for (const s of mine) {
        expect(s.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        // A page address without its scheme (see CoachStintEntry.source).
        expect(s.source, `${sport} ${team} ${s.coach} source`).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}\/\S*$/i)
      }
      // Today is covered, so a live projection can read a level — except where no one is in charge.
      if (vacant) expect(coachingLevelOn(sport, team, Date.now())).toBeUndefined()
      else expect(coachingLevelOn(sport, team, Date.now()), `${sport} ${team} today`).toBeDefined()
    }
  })
})

function weatherDb(games: Array<{ externalId: string; homeTeam: string; awayTeam: string; startTime: Date }>, weather: Array<Record<string, unknown>>) {
  return {
    sportsGame: { findMany: async () => games },
    weatherCache: { findMany: async (q: { where: { eventId: { in: string[] } } }) => weather.filter((w) => q.where.eventId.in.includes(String(w.eventId))) },
  }
}

describe('loadMlbWeatherLevels', () => {
  const g = (id: string, home: string, away: string, iso: string) => ({ externalId: id, homeTeam: home, awayTeam: away, startTime: new Date(iso) })

  it("both teams get their game's stored forecast, on the game's US-Eastern date", async () => {
    // A 10:10pm ET first pitch is 03:10Z the next UTC day — it still belongs to the ET date.
    const db = weatherDb([g('1', 'CHC', 'STL', '2026-05-02T03:10:00Z'), g('2', 'TB', 'NYY', '2026-05-01T23:10:00Z')], [
      { eventId: '1', windSpeedMph: 19, precipChancePct: 10 },
      { eventId: '2', windSpeedMph: 3, precipChancePct: 0, roofClosed: true },
    ])
    const m = await loadMlbWeatherLevels(db as never, ['2026-05-01'])
    expect(Object.fromEntries(m)).toEqual({ '2026-05-01:CHC': 'bad', '2026-05-01:STL': 'bad', '2026-05-01:TB': 'dome', '2026-05-01:NYY': 'dome' })
  })

  it('a doubleheader whose forecasts disagree gets no level; one that agrees keeps it', async () => {
    const db = weatherDb([g('1', 'CLE', 'DET', '2026-05-01T17:10:00Z'), g('2', 'CLE', 'DET', '2026-05-01T23:10:00Z'), g('3', 'MIN', 'KC', '2026-05-01T18:10:00Z'), g('4', 'MIN', 'KC', '2026-05-01T23:40:00Z')], [
      { eventId: '1', windSpeedMph: 5, precipChancePct: 70 },
      { eventId: '2', windSpeedMph: 5, precipChancePct: 10 },
      { eventId: '3', windSpeedMph: 4, precipChancePct: 0 },
      { eventId: '4', windSpeedMph: 6, precipChancePct: 5 },
    ])
    const m = await loadMlbWeatherLevels(db as never, ['2026-05-01'])
    expect(m.has('2026-05-01:CLE')).toBe(false)
    expect(m.get('2026-05-01:MIN')).toBe('normal')
  })

  it('a game with no stored forecast, a failed read, or no days asked: no level', async () => {
    expect((await loadMlbWeatherLevels(weatherDb([g('1', 'CHC', 'STL', '2026-05-01T18:00:00Z')], []) as never, ['2026-05-01'])).size).toBe(0)
    const broken = { sportsGame: { findMany: async () => { throw new Error('down') } }, weatherCache: { findMany: async () => [] } }
    expect((await loadMlbWeatherLevels(broken as never, ['2026-05-01'])).size).toBe(0)
    expect((await loadMlbWeatherLevels(broken as never, [])).size).toBe(0)
  })
})

describe('dailyGameContext', () => {
  const weather = new Map([['2026-05-01:CHC', 'bad']])
  it('weather is MLB only; NBA and NHL play indoors', () => {
    expect(dailyGameContext('MLB', 'Chicago Cubs', at('2026-05-01'), '2026-05-01', weather)?.weather).toBe('bad')
    expect(dailyGameContext('NBA', 'CHI', at('2026-05-01'), '2026-05-01', new Map([['2026-05-01:CHI', 'bad']]))?.weather).toBeUndefined()
  })
  it('nothing for a sport outside the list', () => {
    expect(dailyGameContext('NFL', 'CHI', at('2026-05-01'), '2026-05-01', weather)).toBeUndefined()
  })
})

describe('readGameLines (MLB)', () => {
  it("puts each game's stored weather on the line the learner measures", async () => {
    const day = new Date('2026-05-01T00:00:00Z')
    const db = {
      playerGameStat: {
        findMany: async () => [
          { playerId: 'p1', gameId: 'g1', providerGameId: 'g1', gameDate: day, season: 2026, weekOrRound: 0, team: 'CHC', opponent: 'STL', fantasyPoints: 9, normalizedStatMap: {} },
          { playerId: 'p2', gameId: 'g9', providerGameId: 'g9', gameDate: day, season: 2026, weekOrRound: 0, team: 'SEA', opponent: 'HOU', fantasyPoints: 4, normalizedStatMap: {} },
        ],
      },
      sportsDataCache: { findMany: async () => [] },
      ...weatherDb([{ externalId: '1', homeTeam: 'CHC', awayTeam: 'STL', startTime: new Date('2026-05-01T18:20:00Z') }], [{ eventId: '1', windSpeedMph: 22, precipChancePct: 0 }]),
    }
    const lines = await readGameLines(db as never, 'MLB', new Date('2026-05-10T00:00:00Z'))
    expect(lines.find((l) => l.playerId === 'p1')?.context?.weather).toBe('bad')
    expect(lines.find((l) => l.playerId === 'p2')?.context?.weather).toBeUndefined()
  })
})
