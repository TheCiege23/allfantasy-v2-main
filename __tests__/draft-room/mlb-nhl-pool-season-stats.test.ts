import { describe, expect, it } from 'vitest'
import {
  extractMlbDraftSeasonStats,
  extractNhlDraftSeasonStats,
} from '@/lib/draft-room/sportsPlayerRecordDraftEnrichment'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import {
  getDraftStatColumnsForSport,
  getStatValueForDraftPlayer,
  type DraftStatPlayerSource,
} from '@/lib/draft-room/draftSportStatColumns'

/** Shape `flattenRiSeasonStats` writes for MLB: grouped keys, never bare. */
const MLB_HITTER_ROW = {
  games_played: 158,
  'batting.AB': 600,
  'batting.H': 180,
  'batting.HR': 40,
  'batting.RBI': 110,
  'batting.R': 105,
  'batting.SB': 12,
  'batting.BB': 80,
}

const MLB_PITCHER_ROW = {
  games_played: 32,
  'pitching.IP': 180.2, // 180 and two-thirds
  'pitching.ER': 60,
  'pitching.BB': 50,
  'pitching.H': 150,
  'pitching.K': 210,
  'pitching.W': 15,
  'pitching.S': 0,
}

function valuesFor(sport: 'MLB' | 'NHL', position: string, seasonStatLine: Record<string, number> | null) {
  const entry = normalizeDraftPlayer(
    { name: 'Example Player', position, team: 'NYY', seasonStatLine, fantasyPointsPerGame: 8.23 },
    sport,
  )
  const source = { ...entry, display: entry.display } as unknown as DraftStatPlayerSource
  return Object.fromEntries(
    getDraftStatColumnsForSport(sport, { position }).map((c) => [c.key, getStatValueForDraftPlayer(source, c)]),
  )
}

describe('MLB pool season stats', () => {
  it('maps grouped batting keys onto the hitter columns and derives AVG from H/AB', () => {
    const line = extractMlbDraftSeasonStats(MLB_HITTER_ROW)
    expect(line).toEqual({ homeRuns: 40, rbi: 110, runs: 105, stolenBases: 12, battingAverage: 0.3 })
    expect(valuesFor('MLB', 'OF', line)).toMatchObject({ hr: 40, rbi: 110, r: 105, sb: 12, avg: 0.3 })
  })

  it('derives ERA and WHIP from baseball-notation innings', () => {
    const line = extractMlbDraftSeasonStats(MLB_PITCHER_ROW)!
    // 180.2 IP is 180.667 innings: ERA = 60*9/180.667, WHIP = 200/180.667
    expect(line.era).toBe(2.99)
    expect(line.whip).toBe(1.11)
    expect(valuesFor('MLB', 'SP', line)).toMatchObject({ w: 15, so: 210, sv: 0, era: 2.99, whip: 1.11 })
  })

  it('never reads a pitcher’s hits or walks allowed as batting stats', () => {
    const line = extractMlbDraftSeasonStats(MLB_PITCHER_ROW)!
    expect(line.battingAverage).toBeUndefined()
    expect(line.runs).toBeUndefined()
    expect(line.homeRuns).toBeUndefined()
  })

  it('reads the nested regular_season.{batting,pitching} shape too', () => {
    expect(extractMlbDraftSeasonStats({ regular_season: { batting: { HR: 9, AB: 100, H: 25 } } }))
      .toEqual({ homeRuns: 9, battingAverage: 0.25 })
  })

  it('does not show fantasy points per game under AVG when no batting average exists', () => {
    expect(valuesFor('MLB', 'OF', null).avg).toBeNull()
  })

  it('leaves OBP empty rather than deriving it without sacrifice flies', () => {
    expect(extractMlbDraftSeasonStats(MLB_HITTER_ROW)?.onBasePercentage).toBeUndefined()
    expect(extractMlbDraftSeasonStats({ 'batting.OBP': 0.401 })?.onBasePercentage).toBe(0.401)
  })

  it('returns null for an empty or missing row', () => {
    expect(extractMlbDraftSeasonStats({})).toBeNull()
    expect(extractMlbDraftSeasonStats(null)).toBeNull()
  })
})

describe('NHL pool season stats', () => {
  it('maps skater keys onto the skater columns', () => {
    const line = extractNhlDraftSeasonStats({ games_played: 82, goals: 50, assists: 60, shots_on_goal: 300, blocks: 25, time_on_ice: '1640:00' })
    expect(line).toEqual({ goals: 50, assists: 60, shots_on_goal: 300, blocks: 25 })
    expect(valuesFor('NHL', 'C', line)).toMatchObject({ g: 50, a: 60, sog: 300, blk_nhl: 25 })
  })

  it('derives SV% and GAA for goalies from saves, shots against and time on ice', () => {
    const line = extractNhlDraftSeasonStats({
      win: 35, saves: 1650, shots_against: 1800, goals_allowed: 150, shutouts: 4, time_on_ice: '3600:00',
    })!
    expect(line).toEqual({ saves: 1650, wins: 35, shutouts: 4, goalsAgainstAverage: 2.5, savePercentage: 0.917 })
    expect(valuesFor('NHL', 'G', line)).toMatchObject({ sv_nhl: 1650, w_nhl: 35, sho: 4, gaa: 2.5, svp: 0.917 })
  })

  it('does not attach NHL or MLB lines to another sport', () => {
    const entry = normalizeDraftPlayer({ name: 'Example', position: 'PG', team: 'BOS', seasonStatLine: { goals: 3 } }, 'NBA')
    expect((entry.display.stats as Record<string, unknown>).goals).toBeUndefined()
  })
})
