/**
 * The soccer trade-grade board (2026-10-09): this season's matches steadied by last season, on the club
 * match scale, active players only.
 */
import { describe, expect, it } from 'vitest'
import { blendSoccerSeasons, clubMatchCounts, PRIOR_SEASON_APPEARANCES } from '@/lib/decision-os/trade/soccerBoard'
import type { SoccerSeasonLine } from '@/lib/af-projections/soccerSeasonLines'

const line = (playerId: string, team: string, totals: Record<string, number>, season = '2026'): SoccerSeasonLine => ({
  playerId, season, stats: { riTeam: team, position: 'FWD', riPlayerName: playerId, regular_season: totals },
})
const clubs = (current: Record<string, number>, prior: Record<string, number> = {}) => ({
  current: new Map(Object.entries(current)), prior: new Map(Object.entries(prior)),
})
const byId = (lines: ReturnType<typeof blendSoccerSeasons>) => new Map(lines.map((l) => [l.playerId, l]))

describe('blendSoccerSeasons', () => {
  it('steadies four matches with last season — a hot start does not outrank a full season', () => {
    // Hot start: 3 goals in 4. Last season: 10 in 38. Last season counts as ten appearances.
    const out = byId(blendSoccerSeasons({
      current: [line('striker', 'ARS', { games_played: 4, goals: 3 })],
      prior: [line('striker', 'ARS', { games_played: 38, goals: 10 }, '2025')],
      clubMatches: clubs({ ARS: 4 }, { ARS: 38 }),
    }))
    const s = out.get('striker')!
    expect(s.sampleGames).toBe(4 + PRIOR_SEASON_APPEARANCES)
    expect(s.share).toBe(1)
    expect(s.stats.goals).toBeCloseTo((3 + 10 * (10 / 38)) / 14, 9)
  })

  it('lets this season take over as it fills in: last season never counts for more than ten matches', () => {
    const late = byId(blendSoccerSeasons({
      current: [line('p', 'ARS', { games_played: 30, goals: 30 })],
      prior: [line('p', 'ARS', { games_played: 38, goals: 0 }, '2025')],
      clubMatches: clubs({ ARS: 30 }, { ARS: 38 }),
    })).get('p')!
    expect(late.stats.goals).toBeCloseTo(30 / 40, 9)
  })

  it('stands a player with no prior season on his own matches, and on his own sample', () => {
    const rookie = byId(blendSoccerSeasons({
      current: [line('new', 'ARS', { games_played: 4, goals: 2 })],
      prior: [],
      clubMatches: clubs({ ARS: 4 }),
    })).get('new')!
    expect(rookie).toMatchObject({ sampleGames: 4, share: 1, priorAppearances: 0 })
    expect(rookie.stats.goals).toBeCloseTo(0.5, 9)
  })

  it('scales a rotation player to his share of his club’s matches', () => {
    const out = byId(blendSoccerSeasons({
      current: [line('starter', 'CHE', { games_played: 6, goals: 3 }), line('rotation', 'CHE', { games_played: 3, goals: 1.5 })],
      prior: [],
      clubMatches: clubs({ CHE: 6 }),
    }))
    // The same goals per appearance, half the matches: half the value per club match.
    expect(out.get('rotation')!.share).toBeCloseTo(0.5, 9)
    expect(out.get('rotation')!.stats.goals).toBeCloseTo(out.get('starter')!.stats.goals / 2, 9)
  })

  it('steadies the share with last season’s too', () => {
    const p = byId(blendSoccerSeasons({
      current: [line('p', 'CHE', { games_played: 2, goals: 0 })],
      prior: [line('p', 'CHE', { games_played: 34, goals: 0 }, '2025')],
      clubMatches: clubs({ CHE: 6 }, { CHE: 38 }),
    })).get('p')!
    expect(p.share).toBeCloseTo((2 + 10 * (34 / 38)) / (6 + 10), 9)
  })

  it('keeps last season’s departures off the board — they would set the waiver wire', () => {
    const out = byId(blendSoccerSeasons({
      current: [line('stayed', 'ARS', { games_played: 4, goals: 1 })],
      prior: [line('stayed', 'ARS', { games_played: 30, goals: 5 }, '2025'), line('left', 'ARS', { games_played: 35, goals: 20 }, '2025')],
      clubMatches: clubs({ ARS: 4 }, { ARS: 38 }),
    }))
    expect([...out.keys()]).toEqual(['stayed'])
  })

  it('never puts a player past every one of his club’s matches — a mid-season transfer', () => {
    const p = byId(blendSoccerSeasons({
      current: [line('moved', 'NEW', { games_played: 6, goals: 1 })],
      prior: [],
      clubMatches: clubs({ NEW: 3 }),
    })).get('moved')!
    expect(p.share).toBe(1)
  })
})

describe('clubMatchCounts', () => {
  it('counts a match once, though the ingest writes one row per group', () => {
    const counts = clubMatchCounts([
      { team: 'ARS', gameId: '20260920-12-2:fielders' },
      { team: 'ARS', gameId: '20260920-12-2:goalkeepers' },
      { team: 'ARS', gameId: '20260927-3-1:fielders' },
      { team: null, gameId: '20260927-3-1:fielders' },
    ])
    expect(counts.get('ARS')).toBe(2)
    expect(counts.size).toBe(1)
  })
})
